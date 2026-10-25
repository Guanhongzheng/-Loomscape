/**
 * Shared by the server page (which validates `?tab=`) and the client workspace
 * (which renders it). A plain module on purpose: a function exported from a
 * `'use client'` file cannot be called during a server render.
 */
export type CreateTab = 'text' | 'image' | 'video' | 'voice' | 'story';

const TAB_IDS: CreateTab[] = ['text', 'image', 'video', 'voice', 'story'];

export function isCreateTab(value?: string): value is CreateTab {
  return TAB_IDS.includes(value as CreateTab);
}
