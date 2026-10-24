'use client';

import { STORES, all, getPref, put, remove, setPref } from './db';
import { opaqueId } from './id';
import { findModel, useEngines } from './engines';
import { embedTexts, hasWeights, isResident } from './local-runtime';
import { requestEmbeddings } from './api';
import { useEndpoints } from './endpoint-store';
import { hasKey } from './providers';
import { chunkText, type RagSource } from './rag';

export type MemoryKind = 'text' | 'image' | 'voice' | 'video' | 'story' | 'note' | 'doc';

export type MemorySource = {
  docId: string;
  docTitle: string;
  chunk: number;
  total: number;
};

export type MemoryRecord = {
  id: string;
  owner: string;
  kind: MemoryKind;
  text: string;
  vector: number[];
  embedder: string;
  tags: string[];
  createdAt: number;
  /** Present when the record is one chunk of an ingested document. */
  source?: MemorySource;
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
    // A cached model still has to be loaded before it can encode anything, and
    // only one model is resident at a time, so "local" means "currently loaded".
    if (model && isResident(model.id)) {
      return { tag: `local:${model.id}`, label: model.label, dims: model.dims };
    }
    const cached = model ? await hasWeights(model.repo) : false;
    return {
      tag: 'hash',
      label: cached ? `哈希（${model?.label ?? '本地模型'} 未加载）` : '哈希（模型未下载）',
      dims: HASH_DIM,
    };
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

export type RetrieveOptions = {
  topK?: number;
  minScore?: number;
  kinds?: MemoryKind[];
};

/**
 * Vector search over the local memory store. The query and the stored rows
 * must share an embedder tag: comparing a hash vector with a BGE vector would
 * produce a meaningless cosine, so mismatched rows are dropped rather than
 * scored.
 */
export async function retrieve(
  query: string,
  owner: string,
  options: RetrieveOptions = {},
): Promise<RecallHit[]> {
  const { enabled, depth } = await readMemoryPrefs();
  if (!enabled || !query.trim()) return [];

  const topK = options.topK ?? 4;
  const minScore = options.minScore ?? 0.12;

  let rows: MemoryRecord[] = [];
  try {
    rows = await all<MemoryRecord>(STORES.memories);
  } catch {
    return [];
  }

  const embedder = await activeEmbedder();
  const pool = rows
    .filter((row) => row.owner === owner && row.embedder === embedder.tag)
    .filter((row) => !options.kinds || options.kinds.includes(row.kind))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, DEPTH_LIMIT[depth]);

  if (!pool.length) return [];

  const [probe] = await vectorize([query], embedder);
  return pool
    .map((record) => ({ record, score: cosine(probe, record.vector) }))
    .filter((hit) => hit.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function recall(query: string, owner: string, topK = 4): Promise<RecallHit[]> {
  return retrieve(query, owner, { topK });
}

export type DocumentSummary = {
  docId: string;
  title: string;
  chunks: number;
  chars: number;
  createdAt: number;
};

/** Guards against a paste of several megabytes turning into thousands of rows. */
const MAX_CHUNKS = 240;

export async function rememberDocument(input: {
  owner: string;
  title: string;
  text: string;
}): Promise<DocumentSummary> {
  const body = input.text.trim();
  if (body.length < 20) throw new Error('内容太短，至少需要 20 个字');

  const chunks = chunkText(body);
  if (!chunks.length) throw new Error('没有可入库的内容');
  if (chunks.length > MAX_CHUNKS) {
    throw new Error(`文档过长（${chunks.length} 段，上限 ${MAX_CHUNKS} 段），请拆分后再入库`);
  }

  const selected = await activeEmbedder();
  const vectors = await vectorize(
    chunks.map((chunk) => chunk.text),
    selected,
  );

  // A short batch means the encoder failed partway. Mixing hash vectors under
  // a model tag would put two vector spaces in one index, so fall back whole.
  const embedder: EmbedderInfo =
    vectors.length === chunks.length
      ? selected
      : { tag: 'hash', label: '哈希（嵌入失败后的回退）', dims: HASH_DIM };
  const vectorsFinal =
    vectors.length === chunks.length ? vectors : chunks.map((chunk) => hashEmbed(chunk.text));

  const docId = opaqueId('doc');
  const title = input.title.trim().slice(0, 80) || `未命名资料 ${new Date().toLocaleDateString('zh-CN')}`;
  const now = Date.now();

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const record: MemoryRecord = {
      id: opaqueId('mem'),
      owner: input.owner,
      kind: 'doc',
      text: chunk.text.slice(0, 1200),
      vector: vectorsFinal[index] ?? hashEmbed(chunk.text),
      embedder: embedder.tag,
      tags: ['rag', title],
      createdAt: now + index,
      source: { docId, docTitle: title, chunk: chunk.index, total: chunks.length },
    };
    await put(STORES.memories, record);
  }

  return { docId, title, chunks: chunks.length, chars: body.length, createdAt: now };
}

export async function listDocuments(owner: string): Promise<DocumentSummary[]> {
  const rows = await listMemories(owner);
  const grouped = new Map<string, DocumentSummary>();

  for (const row of rows) {
    if (!row.source) continue;
    const existing = grouped.get(row.source.docId);
    if (existing) {
      existing.chunks += 1;
      existing.chars += row.text.length;
    } else {
      grouped.set(row.source.docId, {
        docId: row.source.docId,
        title: row.source.docTitle,
        chunks: 1,
        chars: row.text.length,
        createdAt: row.createdAt,
      });
    }
  }

  return Array.from(grouped.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export async function forgetDocument(owner: string, docId: string): Promise<void> {
  const rows = await listMemories(owner);
  await Promise.all(
    rows.filter((row) => row.source?.docId === docId).map((row) => remove(STORES.memories, row.id)),
  );
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

/** Adapts retrieval hits to the numbered form the prompt builder expects. */
export function toRagSources(hits: RecallHit[]): RagSource[] {
  return hits.map((hit, index) => ({
    order: index + 1,
    text: hit.record.text,
    title: hit.record.source?.docTitle,
    chunk: hit.record.source?.chunk,
    total: hit.record.source?.total,
    score: hit.score,
  }));
}
