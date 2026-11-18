'use client';

import { create } from 'zustand';
import { getPref, setPref } from './db';
import { useAuth } from './auth';
import {
  estimateReindex,
  reindexDocuments,
  type ReindexEstimate,
  type ReindexProgress,
} from './memory';

/** Conservative default: ¥3 per million tokens. Users can override it. */
export const DEFAULT_EMBED_PRICE = 3;
const PRICE_KEY = 'embed.price';

type Phase = 'confirm' | 'warning' | 'running' | 'done' | 'error';

/** Held outside the store: a closure in state is easy to leak and re-render. */
let applyRef: (() => Promise<void>) | null = null;
let cancelRequested = false;

type State = {
  open: boolean;
  phase: Phase;
  label: string;
  estimate: ReindexEstimate | null;
  progress: ReindexProgress | null;
  error: string | null;
  price: number;
  /** True when opened from the knowledge panel instead of a model switch. */
  manual: boolean;
  loadPrice: () => Promise<void>;
  savePrice: (price: number) => Promise<void>;
  request: (label: string, nextTag: string, apply: () => Promise<void>) => Promise<void>;
  goWarning: () => void;
  back: () => void;
  close: () => void;
  switchOnly: () => Promise<void>;
  rebuild: () => Promise<void>;
  requestRebuildManual: () => Promise<boolean>;
  stop: () => void;
};

export const useEmbeddingGate = create<State>((set, get) => {
  const owner = () => useAuth.getState().user?.id ?? 'local';

  return {
    open: false,
    phase: 'confirm',
    label: '',
    estimate: null,
    progress: null,
    error: null,
    price: DEFAULT_EMBED_PRICE,
    manual: false,

    loadPrice: async () => {
      const stored = await getPref<number>(PRICE_KEY, DEFAULT_EMBED_PRICE).catch(
        () => DEFAULT_EMBED_PRICE,
      );
      set({ price: Number.isFinite(stored) && stored >= 0 ? stored : DEFAULT_EMBED_PRICE });
    },

    savePrice: async (price) => {
      const next = Number.isFinite(price) && price >= 0 ? price : DEFAULT_EMBED_PRICE;
      set({ price: next });
      await setPref(PRICE_KEY, next).catch(() => undefined);
    },

    /**
     * Called right before an embedder change is applied. Only the rows that
     * belong to another model force the dialog, so switching back and forth
     * stays silent.
     */
    request: async (label, nextTag, apply) => {
      await get().loadPrice();
      const estimate = await estimateReindex(owner(), nextTag).catch(() => null);
      if (!estimate || estimate.docs === 0) {
        await apply();
        return;
      }
      applyRef = apply;
      cancelRequested = false;
      set({ open: true, phase: 'confirm', label, estimate, progress: null, error: null, manual: false });
    },

    goWarning: () => set({ phase: 'warning' }),
    back: () => {
      if (get().manual) get().close();
      else set({ phase: 'confirm' });
    },

    close: () => {
      if (get().phase === 'running') return;
      applyRef = null;
      set({ open: false, phase: 'confirm', estimate: null, progress: null, error: null, manual: false });
    },

    switchOnly: async () => {
      const apply = applyRef;
      applyRef = null;
      set({ open: false, phase: 'confirm', estimate: null, progress: null, error: null });
      if (apply) await apply();
    },

    rebuild: async () => {
      const apply = applyRef;
      set({ phase: 'running', error: null, progress: null });
      try {
        if (apply) await apply();
        const result = await reindexDocuments(owner(), {
          onProgress: (progress) => set({ progress }),
          shouldCancel: () => cancelRequested,
        });
        set({
          phase: result.failedDocs > 0 ? 'error' : 'done',
          progress: result,
          error:
            result.failedDocs > 0
              ? `${result.failedDocs} 篇没有重建成功，其余已完成；可稍后重试。`
              : result.cancelled
                ? '已停止，完成的部分保留。'
                : null,
        });
        applyRef = null;
      } catch (error) {
        set({ phase: 'error', error: error instanceof Error ? error.message : '重建失败' });
      }
    },

    /**
     * Entry from the knowledge panel: no switch to apply, straight to the
     * estimate. Returns false when there is nothing to do, so the caller can
     * toast instead of opening an empty dialog.
     */
    requestRebuildManual: async () => {
      await get().loadPrice();
      const estimate = await estimateReindex(owner()).catch(() => null);
      applyRef = null;
      if (!estimate || estimate.docs === 0) {
        set({ manual: true, open: false });
        return false;
      }
      cancelRequested = false;
      set({
        open: true,
        manual: true,
        phase: 'warning',
        label: estimate.targetLabel,
        estimate,
        progress: null,
        error: null,
      });
      return true;
    },

    stop: () => {
      cancelRequested = true;
    },
  };
});

export async function requestEmbeddingChange(
  label: string,
  nextTag: string,
  apply: () => Promise<void>,
): Promise<void> {
  await useEmbeddingGate.getState().request(label, nextTag, apply);
}

export function formatCost(tokens: number, pricePerMTok: number): string {
  const cost = (tokens / 1_000_000) * pricePerMTok;
  if (cost <= 0) return '免费';
  if (cost < 0.01) return `约 ¥${cost.toFixed(4)}`;
  if (cost < 1) return `约 ¥${cost.toFixed(3)}`;
  return `约 ¥${cost.toFixed(2)}`;
}

/** Seconds, rounded to something a human would say out loud. */
export function formatDuration(chunks: number, local: boolean): string {
  const seconds = local ? Math.max(2, chunks / 5) : Math.max(2, Math.ceil(chunks / 16) * 1.6);
  if (seconds < 60) return `约 ${Math.ceil(seconds)} 秒`;
  const minutes = seconds / 60;
  return `约 ${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} 分钟`;
}

export function isLocalEmbedder(tag: string): boolean {
  return tag.startsWith('local:');
}
