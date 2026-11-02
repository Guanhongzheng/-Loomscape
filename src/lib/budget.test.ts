import { describe, expect, it } from 'vitest';
import { budgetsFor, GPU_CEILING_MB, WASM_CEILING_MB } from '@/lib/budget';
import { configureBudgets, poolBudgetMB } from '@/lib/engines';

describe('budgetsFor', () => {
  it('keeps the verified ceiling when the device reports nothing', () => {
    // A missing or nonsense `deviceMemory` must not invent headroom, and must
    // not shrink the machine either: fall back to "8 or more".
    expect(budgetsFor(undefined)).toEqual({ wasm: WASM_CEILING_MB, gpu: GPU_CEILING_MB });
    expect(budgetsFor(0)).toEqual({ wasm: WASM_CEILING_MB, gpu: GPU_CEILING_MB });
    expect(budgetsFor(Number.NaN)).toEqual({ wasm: WASM_CEILING_MB, gpu: GPU_CEILING_MB });
  });

  it('never guesses above the ceiling, because 8 means "8 or more"', () => {
    expect(budgetsFor(8).wasm).toBe(WASM_CEILING_MB);
    expect(budgetsFor(32).wasm).toBe(WASM_CEILING_MB);
    expect(budgetsFor(32).gpu).toBe(GPU_CEILING_MB);
  });

  it('lowers the wasm ceiling on small devices', () => {
    // 2GB: the 600MB runtime plus a decoder's ×3 peak cannot fit 3.4GB, and
    // trying ends in Aborted() after the download.
    expect(budgetsFor(2).wasm).toBe(1200);
    expect(budgetsFor(4).wasm).toBe(2200);
  });

  it('never shrinks as the reported memory grows', () => {
    const tiers = [1, 2, 3, 4, 8, 32].map(budgetsFor);
    for (let i = 1; i < tiers.length; i += 1) {
      expect(tiers[i].wasm).toBeGreaterThanOrEqual(tiers[i - 1].wasm);
      expect(tiers[i].gpu).toBeGreaterThanOrEqual(tiers[i - 1].gpu);
    }
  });
});

describe('configureBudgets', () => {
  it('drives poolBudgetMB so every call site sees one answer', () => {
    configureBudgets(2);
    expect(poolBudgetMB('wasm')).toBe(1200);
    expect(poolBudgetMB('gpu')).toBe(2048);

    configureBudgets(8);
    expect(poolBudgetMB('wasm')).toBe(WASM_CEILING_MB);
    expect(poolBudgetMB('gpu')).toBe(GPU_CEILING_MB);
  });
});
