import type { ChatSummary } from './chats';
import type { Project, ProjectKind } from './projects';
import type { CacheStats } from './local-runtime';
import type { StorageUsage } from './storage';

export const PROJECT_KINDS: ProjectKind[] = ['text', 'image', 'video', 'voice', 'story'];

export type OverviewSummary = {
  projectCount: number;
  /** Most recently updated project, or null for a fresh identity. */
  latest: Project | null;
  recentProjects: Project[];
  kindCounts: Record<ProjectKind, number>;
  chatCount: number;
  recentChats: ChatSummary[];
  cachedModels: number;
  cacheBytes: number;
  storageUsed: number;
  storageQuota: number;
  /** 0–1; 0 when the browser refuses to report a quota. */
  storageRatio: number;
};

const emptyCounts = (): Record<ProjectKind, number> => ({
  text: 0,
  image: 0,
  video: 0,
  voice: 0,
  story: 0,
});

/**
 * Everything the overview needs to be specific instead of a generic set of
 * shortcut tiles. Kept pure so the ordering, counts and cache totals can be
 * tested without IndexedDB, Cache Storage or a browser.
 */
export function summariseOverview(input: {
  projects?: Project[] | null;
  chats?: ChatSummary[] | null;
  cache?: Record<string, CacheStats> | null;
  usage?: StorageUsage | null;
  projectLimit?: number;
  chatLimit?: number;
}): OverviewSummary {
  const projects = [...(input.projects ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const chats = [...(input.chats ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);

  const kindCounts = emptyCounts();
  for (const project of projects) {
    if (project.kind in kindCounts) kindCounts[project.kind] += 1;
  }

  const cacheRows = Object.values(input.cache ?? {});
  const cached = cacheRows.filter((row) => row.files > 0);
  const cacheBytes = cached.reduce((sum, row) => sum + row.bytes, 0);

  const used = Math.max(0, input.usage?.used ?? 0);
  const quota = Math.max(0, input.usage?.quota ?? 0);

  return {
    projectCount: projects.length,
    latest: projects[0] ?? null,
    recentProjects: projects.slice(0, input.projectLimit ?? 5),
    kindCounts,
    chatCount: chats.length,
    recentChats: chats.slice(0, input.chatLimit ?? 3),
    cachedModels: cached.length,
    cacheBytes,
    storageUsed: used,
    storageQuota: quota,
    storageRatio: quota > 0 ? Math.min(1, Math.max(0, used / quota)) : 0,
  };
}
