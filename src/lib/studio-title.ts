'use client';

import { create } from 'zustand';

type StudioTitleState = {
  title: string;
  setTitle: (title: string) => void;
};

/**
 * The workspace header is persistent while its route content changes. Pages
 * publish their real title here instead of duplicating it in the top chrome.
 */
export const useStudioTitle = create<StudioTitleState>((set) => ({
  title: '',
  setTitle: (title) => set({ title: title.trim() }),
}));
