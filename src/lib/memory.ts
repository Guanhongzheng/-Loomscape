'use client';

import { STORES, all, getPref, put, remove, setPref } from './db';
import { opaqueId } from './id';

export type MemoryKind = 'text' | 'image' | 'voice' | 'video' | 'story' | 'note';

export type MemoryRecord = {
  id: string;
  owner: string;
  kind: MemoryKind;
  text: string;
  vector: number[];
  tags: string[];
  createdAt: number;
};

const DIM = 192;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/;

/**
 * Hashed character n-gram embedding. It is not a semantic model, but it gives
 * a stable, dependency-free similarity signal that runs in a few milliseconds
 * and never leaves the browser. Swapping in a transformer encoder later only
 * requires replacing this function.
 */
export function embed(text: string): number[] {
  const vector = new Float32Array(DIM);
  const source = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!source) return Array.from(vector);

  const tokens: Array<{ token: string; weight: number }> = [];
  let latin = '';

  const flushLatin = () => {
    if (latin.length > 1) tokens.push({ token: latin, weight: 1 });
    latin = '';
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (CJK.test(char)) {
      flushLatin();
      tokens.push({ token: char, weight: 0.45 });
      if (i + 1 < source.length && CJK.test(source[i + 1])) {
        tokens.push({ token: char + source[i + 1], weight: 1 });
      }
    } else if (/[a-z0-9]/.test(char)) {
      latin += char;
    } else {
      flushLatin();
    }
  }
  flushLatin();

  for (const { token, weight } of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const index = Math.abs(h) % DIM;
    const sign = (h & 0x80000000) === 0 ? 1 : -1;
    vector[index] += sign * weight * (1 + token.length * 0.12);
  }

  let norm = 0;
  for (let i = 0; i < DIM; i += 1) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i += 1) vector[i] /= norm;

  return Array.from(vector, (v) => Math.round(v * 1e5) / 1e5);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

export type MemoryDepth = 'low' | 'mid' | 'high';

const DEPTH_LIMIT: Record<MemoryDepth, number> = { low: 10, mid: 30, high: Number.MAX_SAFE_INTEGER };

export async function readMemoryPrefs(): Promise<{ enabled: boolean; depth: MemoryDepth }> {
  const enabled = await getPref('memory.enabled', true);
  const depth = await getPref<MemoryDepth>('memory.depth', 'mid');
  return { enabled, depth };
}

export async function setMemoryPrefs(patch: { enabled?: boolean; depth?: MemoryDepth }) {
  if (patch.enabled !== undefined) await setPref('memory.enabled', patch.enabled);
  if (patch.depth !== undefined) await setPref('memory.depth', patch.depth);
}

export async function remember(input: {
  owner: string;
  kind: MemoryKind;
  text: string;
  tags?: string[];
}): Promise<MemoryRecord | null> {
  const { enabled } = await readMemoryPrefs();
  if (!enabled) return null;

  const text = input.text.trim().slice(0, 600);
  if (text.length < 6) return null;

  const record: MemoryRecord = {
    id: opaqueId('mem'),
    owner: input.owner,
    kind: input.kind,
    text,
    vector: embed(text),
    tags: input.tags ?? [],
    createdAt: Date.now(),
  };

  try {
    await put(STORES.memories, record);
    return record;
  } catch {
    return null;
  }
}

export type RecallHit = { record: MemoryRecord; score: number };

export async function recall(query: string, owner: string, topK = 4): Promise<RecallHit[]> {
  const { enabled, depth } = await readMemoryPrefs();
  if (!enabled || !query.trim()) return [];

  let rows: MemoryRecord[] = [];
  try {
    rows = await all<MemoryRecord>(STORES.memories);
  } catch {
    return [];
  }

  const pool = rows
    .filter((row) => row.owner === owner)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, DEPTH_LIMIT[depth]);

  if (!pool.length) return [];

  const probe = embed(query);
  return pool
    .map((record) => ({ record, score: cosine(probe, record.vector) }))
    .filter((hit) => hit.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export async function listMemories(owner: string): Promise<MemoryRecord[]> {
  try {
    const rows = await all<MemoryRecord>(STORES.memories);
    return rows.filter((row) => row.owner === owner).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function forget(id: string): Promise<void> {
  await remove(STORES.memories, id);
}

export async function forgetAll(owner: string): Promise<void> {
  const rows = await listMemories(owner);
  await Promise.all(rows.map((row) => remove(STORES.memories, row.id)));
}

/** Compact block appended to the system prompt so recall stays cheap. */
export function memoryContext(hits: RecallHit[]): string {
  if (!hits.length) return '';
  const lines = hits.map((hit, index) => `${index + 1}. [${hit.record.kind}] ${hit.record.text}`);
  return ['以下是这个人过去留下的偏好与上下文，保持连贯但不要生硬复述：', ...lines].join('\n');
}
