'use client';

import { create } from 'zustand';

/**
 * Unread bookkeeping for conversations.
 *
 * Counts are derived from `seenAt` rather than kept as a running total: the
 * authoritative messages live in IndexedDB, so a count that only increments on
 * live events drifts as soon as a tab is closed or the page reloads. The store
 * persists the watermark; the caller recounts against it.
 */

const STORAGE_KEY = 'loomscape:unread';

export type UnreadState = {
  /** conversationId → number of messages arrived after the watermark. */
  counts: Record<string, number>;
  /** conversationId → timestamp up to which messages count as read. */
  seenAt: Record<string, number>;
  /** conversationId → announcement version the reader has already seen. */
  announcementSeen: Record<string, number>;
  load: () => void;
  /** First sight of a conversation: remember it without marking its history unread. */
  known: (conversationId: string, updatedAt: number, announcementAt?: number) => void;
  setCount: (conversationId: string, count: number) => void;
  bump: (conversationId: string) => void;
  markRead: (conversationId: string, at?: number) => void;
  markAnnouncementSeen: (conversationId: string, at: number) => void;
  total: () => number;
  reset: () => void;
};

type Persisted = Pick<UnreadState, 'counts' | 'seenAt' | 'announcementSeen'>;

function read(): Persisted {
  if (typeof localStorage === 'undefined') {
    return { counts: {}, seenAt: {}, announcementSeen: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { counts: {}, seenAt: {}, announcementSeen: {} };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      counts: parsed.counts ?? {},
      seenAt: parsed.seenAt ?? {},
      announcementSeen: parsed.announcementSeen ?? {},
    };
  } catch {
    return { counts: {}, seenAt: {}, announcementSeen: {} };
  }
}

function persist(state: Persisted): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // a full or blocked storage must not break the inbox
  }
}

export const useUnread = create<UnreadState>((set, get) => ({
  counts: {},
  seenAt: {},
  announcementSeen: {},

  load: () => set(read()),

  known: (conversationId, updatedAt, announcementAt = 0) =>
    set((state) => {
      if (state.seenAt[conversationId] !== undefined) return state;
      const next = {
        counts: state.counts,
        seenAt: { ...state.seenAt, [conversationId]: updatedAt },
        announcementSeen: { ...state.announcementSeen, [conversationId]: announcementAt },
      };
      persist(next);
      return next;
    }),

  setCount: (conversationId, count) =>
    set((state) => {
      const next = { ...state.counts, [conversationId]: Math.max(0, count) };
      persist({ counts: next, seenAt: state.seenAt, announcementSeen: state.announcementSeen });
      return { counts: next };
    }),

  bump: (conversationId) =>
    set((state) => {
      const next = { ...state.counts, [conversationId]: (state.counts[conversationId] ?? 0) + 1 };
      persist({ counts: next, seenAt: state.seenAt, announcementSeen: state.announcementSeen });
      return { counts: next };
    }),

  markRead: (conversationId, at = Date.now()) =>
    set((state) => {
      const seenAt = { ...state.seenAt, [conversationId]: at };
      const counts = { ...state.counts, [conversationId]: 0 };
      persist({ counts, seenAt, announcementSeen: state.announcementSeen });
      return { counts, seenAt };
    }),

  markAnnouncementSeen: (conversationId, at) =>
    set((state) => {
      const announcementSeen = { ...state.announcementSeen, [conversationId]: at };
      persist({ counts: state.counts, seenAt: state.seenAt, announcementSeen });
      return { announcementSeen };
    }),

  total: () => Object.values(get().counts).reduce((sum, value) => sum + value, 0),

  reset: () => {
    persist({ counts: {}, seenAt: {}, announcementSeen: {} });
    set({ counts: {}, seenAt: {}, announcementSeen: {} });
  },
}));

/** Total unread messages, for the dock badge. */
export function unreadTotal(state: Pick<UnreadState, 'counts'>): number {
  return Object.values(state.counts).reduce((sum, value) => sum + value, 0);
}
