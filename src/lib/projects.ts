'use client';

import { STORES, all, put, remove } from './db';
import { opaqueId } from './id';

export type ProjectKind = 'text' | 'image' | 'video' | 'voice' | 'story';

export type Project = {
  id: string;
  owner: string;
  kind: ProjectKind;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export async function saveProject(input: {
  owner: string;
  kind: ProjectKind;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  id?: string;
}): Promise<Project> {
  const now = Date.now();
  const record: Project = {
    id: input.id ?? opaqueId(input.kind),
    owner: input.owner,
    kind: input.kind,
    title: input.title.slice(0, 120) || '未命名',
    summary: input.summary.slice(0, 240),
    payload: input.payload,
    createdAt: now,
    updatedAt: now,
  };
  await put(STORES.projects, record);
  return record;
}

export async function listProjects(owner: string, kind?: ProjectKind): Promise<Project[]> {
  try {
    const rows = await all<Project>(STORES.projects);
    return rows
      .filter((row) => row.owner === owner && (!kind || row.kind === kind))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function deleteProject(id: string): Promise<void> {
  await remove(STORES.projects, id);
}

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}
