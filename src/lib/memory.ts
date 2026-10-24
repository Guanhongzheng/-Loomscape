'use client';

import { STORES, all, getPref, put, remove, setPref } from './db';
import { opaqueId } from './id';
import { findModel, useEngines } from './engines';
import { embedTexts, isModelCached } from './local-runtime';
import { requestEmbeddings } from './api';
import { useEndpoints } from './endpoint-store';
import { hasKey } from './providers';

export type MemoryKind = 'text' | 'image' | 'voice' | 'video' | 'story' | 'note';

export type MemoryRecord = {
  id: string;
  owner: string;
  kind: MemoryKind;
  text: string;
  vector: number[];
  embedder: string;
  tags: string[];
  createdAt: number;
};

const HASH_DIM = 192;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/;

/**
 * Hashed character n-gram embedding. Kept as the zero-dependency fallback: it
 * runs in a few milliseconds and never leaves the browser. A real encoder plugs
 * into the same interface, so the rest of the memory layer does not care which
 * one produced the vector.
 */
export function hashEmbed(text: string): number[] {
  const vector = new Float32Array(HASH_DIM);
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
    const index = Math.abs(h) % HASH_DIM;
    const sign = (h & 0x80000000) === 0 ? 1 : -1;
    vector[index] += sign * weight * (1 + token.length * 0.12);
  }

  let norm = 0;
  for (let i = 0; i < HASH_DIM; i += 1) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < HASH_DIM; i += 1) vector[i] /= norm;

  return Array.from(vector, (v) => Math.round(v * 1e5) / 1e5);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

export type EmbedderInfo = { tag: string; label: string; dims?: number };

/**
 * Picks the embedding path the settings currently ask for, and degrades to the
 * hashed encoder when the model is not downloaded or the endpoint has no key.
 */
export async function activeEmbedder(): Promise<EmbedderInfo> {
  const { prefs } = useEngines.getState();

  if (prefs.embeddingMode === 'local') {
    const model = findModel(prefs.embeddingModelId);
    if (model && (await isModelCached(model.repo))) {
      return { tag: `local:${model.id}`, label: model.label, dims: model.dims };
    }
    return { tag: 'hash', label: '哈希（模型未下载）', dims: HASH_DIM };
  }

  if (prefs.embeddingMode === 'api') {
    const state = useEndpoints.getState();
    if (hasKey(state.endpoints.embedding) || state.health.embedding) {
      return { tag: `api:${state.endpoints.embedding.model}`, label: state.endpoints.embedding.model };
    }
    return { tag: 'hash', label: '哈希（未配置嵌入端点）', dims: HASH_DIM };
  }

  return { tag: 'hash', label: '哈希', dims: HASH_DIM };
}

async function vectorize(texts: string[], embedder: EmbedderInfo): Promise<number[][]> {
  const { prefs } = useEngines.getState();

  if (embedder.tag.startsWith('local:')) {
    const model = findModel(prefs.embeddingModelId);
    if (!model) return texts.map(hashEmbed);
    try {
      const { vectors } = await embedTexts(model, texts, {
        source: prefs.source,
        backendPreference: prefs.backend,
        report: false,
      });
      return vectors;
    } catch {
      return texts.map(hashEmbed);
    }
  }

  if (embedder.tag.startsWith('api:')) {
    const endpoint = useEndpoints.getState().endpoints.embedding;
    try {
      return await requestEmbeddings({ endpoint, input: texts });
    } catch {
      return texts.map(hashEmbed);
    }
  }

  return texts.map(hashEmbed);
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

  const embedder = await activeEmbedder();
  const [vector] = await vectorize([text], embedder);

  const record: MemoryRecord = {
    id: opaqueId('mem'),
    owner: input.owner,
    kind: input.kind,
    text,
    vector,
    embedder: embedder.tag,
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

  const embedder = await activeEmbedder();
  const pool = rows
    .filter((row) => row.owner === owner && row.embedder === embedder.tag)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, DEPTH_LIMIT[depth]);

  if (!pool.length) return [];

  const [probe] = await vectorize([query], embedder);
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
