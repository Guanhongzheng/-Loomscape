import { describe, expect, it } from 'vitest';
import { PROJECT_KINDS, summariseOverview } from '@/lib/overview';
import type { Project } from '@/lib/projects';
import type { ChatSummary } from '@/lib/chats';
import type { CacheStats } from '@/lib/local-runtime';

const project = (patch: Partial<Project> = {}): Project => ({
  id: 'p1',
  owner: 'local',
  kind: 'text',
  title: '夜书店',
  summary: '一段开场',
  payload: {},
  createdAt: 100,
  updatedAt: 200,
  ...patch,
});

const chat = (patch: Partial<ChatSummary> = {}): ChatSummary => ({
  id: 'c1',
  title: '旧书店几点关门',
  updatedAt: 300,
  turns: 1,
  ...patch,
});

const cacheRow = (patch: Partial<CacheStats> = {}): CacheStats => ({
  files: 2,
  bytes: 600,
  q8: true,
  fp16: false,
  q4f16: false,
  ...patch,
});

const usage = (used: number, quota: number) => ({
  used,
  quota,
  free: Math.max(quota - used, 0),
  ratio: quota > 0 ? used / quota : 0,
});

describe('summariseOverview', () => {
  it('describes a fresh identity without inventing activity', () => {
    const summary = summariseOverview({});
    expect(summary.projectCount).toBe(0);
    expect(summary.latest).toBeNull();
    expect(summary.chatCount).toBe(0);
    expect(summary.cachedModels).toBe(0);
    expect(summary.storageRatio).toBe(0);
    expect(summary.kindCounts).toEqual({ text: 0, image: 0, video: 0, voice: 0, story: 0 });
  });

  it('picks the latest project and keeps the recent list bounded', () => {
    const summary = summariseOverview({
      projects: [
        project({ id: 'old', updatedAt: 10 }),
        project({ id: 'new', updatedAt: 50, title: '最新' }),
        project({ id: 'mid', updatedAt: 30 }),
      ],
      projectLimit: 2,
    });
    expect(summary.latest?.id).toBe('new');
    expect(summary.recentProjects.map((row) => row.id)).toEqual(['new', 'mid']);
    expect(summary.projectCount).toBe(3);
  });

  it('counts every kind and ignores an unknown kind rather than throwing', () => {
    const summary = summariseOverview({
      projects: [
        project({ id: 'a', kind: 'text' }),
        project({ id: 'b', kind: 'text' }),
        project({ id: 'c', kind: 'image' }),
        project({ id: 'd', kind: 'story' }),
        // A record written by a newer build should not break an older one.
        project({ id: 'e', kind: 'future' as Project['kind'] }),
      ],
    });
    expect(summary.kindCounts.text).toBe(2);
    expect(summary.kindCounts.image).toBe(1);
    expect(summary.kindCounts.story).toBe(1);
    expect(summary.projectCount).toBe(5);
  });

  it('sorts chats and keeps the most recent three', () => {
    const summary = summariseOverview({
      chats: [
        chat({ id: 'c1', updatedAt: 10 }),
        chat({ id: 'c3', updatedAt: 30 }),
        chat({ id: 'c2', updatedAt: 20 }),
        chat({ id: 'c4', updatedAt: 40 }),
      ],
    });
    expect(summary.chatCount).toBe(4);
    expect(summary.recentChats.map((row) => row.id)).toEqual(['c4', 'c3', 'c2']);
  });

  it('only sums cache rows that actually hold files', () => {
    const summary = summariseOverview({
      cache: {
        a: cacheRow({ files: 2, bytes: 600 }),
        b: cacheRow({ files: 0, bytes: 0 }),
        c: cacheRow({ files: 1, bytes: 400 }),
      },
    });
    expect(summary.cachedModels).toBe(2);
    expect(summary.cacheBytes).toBe(1000);
  });

  it('clamps a reported storage ratio and tolerates a missing quota', () => {
    expect(summariseOverview({ usage: usage(50, 100) }).storageRatio).toBe(0.5);
    expect(summariseOverview({ usage: usage(200, 100) }).storageRatio).toBe(1);
    expect(summariseOverview({ usage: usage(50, 0) }).storageRatio).toBe(0);
    expect(summariseOverview({ usage: null }).storageRatio).toBe(0);
  });

  it('summarises a large library inside the render budget', () => {
    const projects = Array.from({ length: 5000 }, (_, index) =>
      project({ id: `p${index}`, updatedAt: index, kind: PROJECT_KINDS[index % 5] }),
    );
    const chats = Array.from({ length: 1000 }, (_, index) =>
      chat({ id: `c${index}`, updatedAt: index }),
    );
    const started = performance.now();
    const summary = summariseOverview({ projects, chats, cache: {} });
    const elapsed = performance.now() - started;
    expect(summary.latest?.id).toBe('p4999');
    // Generous enough for CI jitter, tight enough to catch an accidental
    // O(n²) sort or per-item cache scan.
    expect(elapsed).toBeLessThan(250);
  });
});
