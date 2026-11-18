'use client';

import { STORES, all, getPref, put, remove, setPref } from './db';
import { opaqueId } from './id';
import { findModel, useEngines } from './engines';
import { embedTexts, isResident } from './local-runtime';
import { hasWeights } from './cache-status';
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

/** Bumped when the tag format changes; see migrateEmbedderTags(). */
export const EMBED_TAG_VERSION = 2;

/** FNV-1a in base36: short, stable, no async crypto needed. */
function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Vectors from two providers that both call their model "text-embedding-v3"
 * are not comparable. The tag carries the endpoint so switching providers is
 * treated as switching spaces instead of silently mixing them.
 */
export function apiEmbedderTag(endpoint: { model: string; baseUrl: string }): string {
  const base = endpoint.baseUrl.trim().replace(/\/+$/, '').toLowerCase();
  return `api:${endpoint.model}@${shortHash(base)}`;
}
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
      return {
        tag: apiEmbedderTag(state.endpoints.embedding),
        label: state.endpoints.embedding.model,
      };
    }
    return { tag: 'hash', label: '哈希（未配置嵌入端点）', dims: HASH_DIM };
  }

  return { tag: 'hash', label: '哈希', dims: HASH_DIM };
}

/**
 * One-time silent migration: older rows were tagged `api:<model>` without the
 * endpoint. Those vectors came from the currently configured endpoint, so the
 * tag can simply be completed — no re-embedding, no cost. Rows from a different
 * model are left alone; the switch gate handles those.
 */
export async function migrateEmbedderTags(): Promise<number> {
  const version = await getPref<number>('embed.tagVersion', 1).catch(() => 1);
  if (version >= EMBED_TAG_VERSION) return 0;

  // The first visit may run before the stores hydrate; without prefs the mode
  // reads as "hash" and the migration would silently skip.
  if (!useEngines.getState().loaded) await useEngines.getState().load().catch(() => undefined);
  if (!useEndpoints.getState().loaded) await useEndpoints.getState().load().catch(() => undefined);

  const current = await activeEmbedder();
  if (!current.tag.startsWith('api:')) return 0; // nothing to map onto yet
  const currentModel = current.tag.slice(4).split('@')[0];

  let rows: MemoryRecord[] = [];
  try {
    rows = await all<MemoryRecord>(STORES.memories);
  } catch {
    return 0;
  }

  let changed = 0;
  for (const row of rows) {
    if (!row.embedder.startsWith('api:') || row.embedder.includes('@')) continue;
    if (row.embedder.slice(4) !== currentModel) continue;
    await put(STORES.memories, { ...row, embedder: current.tag });
    changed += 1;
  }

  await setPref('embed.tagVersion', EMBED_TAG_VERSION).catch(() => undefined);
  return changed;
}

/** The tag a record gets when the chosen encoder could not produce vectors. */
const HASH_FALLBACK: EmbedderInfo = { tag: 'hash', label: '哈希（嵌入失败后的回退）', dims: HASH_DIM };

/**
 * Returns one vector per text or throws. It used to fall back to hashed vectors
 * on failure, which silently mixed two spaces under one tag: the caller kept
 * the model tag, and those records could never be matched by a real query.
 * Falling back is now the caller's decision, because only it knows whether to
 * re-tag the records.
 */
async function vectorize(texts: string[], embedder: EmbedderInfo): Promise<number[][]> {
  const { prefs } = useEngines.getState();

  if (embedder.tag.startsWith('local:')) {
    const model = findModel(prefs.embeddingModelId);
    if (!model) throw new Error('本地嵌入模型不在目录里');
    const { vectors } = await embedTexts(model, texts, {
      source: prefs.source,
      backendPreference: prefs.backend,
      precision: prefs.gpuPrecision,
      report: false,
    });
    if (vectors.length !== texts.length) throw new Error('编码器返回的向量数量不足');
    return vectors;
  }

  if (embedder.tag.startsWith('api:')) {
    const endpoint = useEndpoints.getState().endpoints.embedding;
    const vectors = await requestEmbeddings({ endpoint, input: texts });
    if (vectors.length !== texts.length) throw new Error('编码器返回的向量数量不足');
    return vectors;
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

  let embedder = await activeEmbedder();
  let vector: number[];
  try {
    [vector] = await vectorize([text], embedder);
  } catch {
    embedder = HASH_FALLBACK;
    vector = hashEmbed(text);
  }

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
  // 0.12 let junk through: a short question like "10-3是多少" scored 0.144
  // against a camera-settings note, and a 0.5B model then answered from that
  // note instead of from arithmetic. Genuine matches measure 0.4 and up.
  const minScore = options.minScore ?? 0.2;

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

  let probe: number[];
  try {
    [probe] = await vectorize([query], embedder);
  } catch {
    // The encoder is unavailable; an empty context is honest, comparing the
    // query in another space would return noise with confident scores.
    return [];
  }
  return pool
    .map((record) => ({ record, score: cosine(probe, record.vector) }))
    .filter((hit) => hit.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function recall(query: string, owner: string, topK = 4): Promise<RecallHit[]> {
  return retrieve(query, owner, { topK });
}

/* ------------------------------------------------------------------ */
/* Reindexing: switching the embedder strands every stored vector, so the */
/* library needs to be re-embedded. Chunk text is persisted, which is what */
/* makes this possible without asking the user to paste anything again.    */
/* ------------------------------------------------------------------ */

/** Tag the active embedder would get for a prospective configuration. */
export function embedderTagFor(
  mode: 'api' | 'local' | 'hash',
  localModelId: string,
  endpoint: { model: string; apiKey: string; baseUrl: string } | undefined,
): string {
  if (mode === 'api' && endpoint && endpoint.apiKey.trim().length > 8 && endpoint.baseUrl.trim()) {
    return apiEmbedderTag(endpoint);
  }
  if (mode === 'local') return `local:${localModelId}`;
  return 'hash';
}

/** Rough token count: CJK ~1 token per char, latin ~1 per 3.2 chars. */
export function approximateTokens(text: string): number {
  let cjk = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x3400 && code <= 0x9fff)) cjk += 1;
  }
  const rest = Math.max(0, text.length - cjk);
  return Math.ceil(cjk + rest / 3.2);
}

export type ReindexEstimate = {
  targetTag: string;
  targetLabel: string;
  docs: number;
  chunks: number;
  chars: number;
  tokens: number;
};

/**
 * What a reindex would touch: only rows whose tag differs from the target.
 * Pure local read, no network and no model call.
 */
export async function estimateReindex(owner: string, targetTag?: string): Promise<ReindexEstimate> {
  const embedder = await activeEmbedder();
  const tag = targetTag ?? embedder.tag;
  let rows: MemoryRecord[] = [];
  try {
    rows = await all<MemoryRecord>(STORES.memories);
  } catch {
    rows = [];
  }
  const pending = rows.filter(
    (row) => row.owner === owner && row.source && row.embedder !== tag,
  );
  const docs = new Set(pending.map((row) => row.source!.docId));
  const chars = pending.reduce((sum, row) => sum + row.text.length, 0);
  const tokens = pending.reduce((sum, row) => sum + approximateTokens(row.text), 0);
  return {
    targetTag: tag,
    targetLabel: tag === embedder.tag ? embedder.label : tag.replace(/^(api|local):/, ''),
    docs: docs.size,
    chunks: pending.length,
    chars,
    tokens,
  };
}

export type IndexHealth = {
  tag: string;
  label: string;
  totalDocs: number;
  pendingDocs: number;
  pendingChunks: number;
  pendingChars: number;
};

/**
 * "Is the library searchable right now?" — the knowledge panel shows this so a
 * stale index is visible instead of discovered when a citation goes missing.
 */
export async function indexHealth(owner: string): Promise<IndexHealth> {
  const embedder = await activeEmbedder();
  const [docs, estimate] = await Promise.all([
    listDocuments(owner).catch(() => []),
    estimateReindex(owner, embedder.tag).catch(() => null),
  ]);
  return {
    tag: embedder.tag,
    label: embedder.label,
    totalDocs: docs.length,
    pendingDocs: estimate?.docs ?? 0,
    pendingChunks: estimate?.chunks ?? 0,
    pendingChars: estimate?.chars ?? 0,
  };
}

export type ReindexProgress = {
  totalDocs: number;
  totalChunks: number;
  doneDocs: number;
  doneChunks: number;
  failedDocs: number;
};

export type ReindexResult = ReindexProgress & { cancelled: boolean };

const REINDEX_BATCH = 16;
const REINDEX_RETRIES = 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Re-embeds documents whose tag differs from the active embedder.
 *
 * Per document: compute every chunk vector first, then write in one go, so a
 * failure or cancel can never leave a document half in the new space. Old
 * vectors are only overwritten after the new ones exist, and the text itself
 * is never touched — the worst case is "temporarily unsearchable", not data
 * loss.
 */
export async function reindexDocuments(
  owner: string,
  options: {
    onProgress?: (progress: ReindexProgress) => void;
    shouldCancel?: () => boolean;
    batchSize?: number;
  } = {},
): Promise<ReindexResult> {
  const embedder = await activeEmbedder();
  const batchSize = options.batchSize ?? REINDEX_BATCH;

  let rows: MemoryRecord[] = [];
  try {
    rows = await all<MemoryRecord>(STORES.memories);
  } catch {
    rows = [];
  }

  const pending = rows.filter(
    (row) => row.owner === owner && row.source && row.embedder !== embedder.tag,
  );
  const byDoc = new Map<string, MemoryRecord[]>();
  for (const row of pending) {
    const key = row.source!.docId;
    const list = byDoc.get(key) ?? [];
    list.push(row);
    byDoc.set(key, list);
  }
  for (const list of byDoc.values()) list.sort((a, b) => (a.source!.chunk ?? 0) - (b.source!.chunk ?? 0));

  const progress: ReindexProgress = {
    totalDocs: byDoc.size,
    totalChunks: pending.length,
    doneDocs: 0,
    doneChunks: 0,
    failedDocs: 0,
  };
  const report = () => options.onProgress?.({ ...progress });
  report();

  let cancelled = false;

  for (const chunks of byDoc.values()) {
    if (options.shouldCancel?.()) {
      cancelled = true;
      break;
    }
    // A second switch mid-run would mix two spaces under one tag.
    const current = await activeEmbedder();
    if (current.tag !== embedder.tag) {
      cancelled = true;
      break;
    }

    let aborted = false;
    const vectors: number[][] = [];
    try {
      for (let i = 0; i < chunks.length; i += batchSize) {
        if (options.shouldCancel?.()) {
          aborted = true;
          cancelled = true;
          break;
        }
        const slice = chunks.slice(i, i + batchSize);
        let attempt = 0;
        let batch: number[][] | null = null;
        while (!batch) {
          try {
            batch = await vectorize(slice.map((row) => row.text), embedder);
          } catch (error) {
            attempt += 1;
            if (attempt >= REINDEX_RETRIES) throw error;
            await wait(600 * 2 ** (attempt - 1));
          }
        }
        vectors.push(...batch);
        progress.doneChunks += slice.length;
        report();
        await wait(0);
      }
    } catch {
      progress.failedDocs += 1;
      report();
      continue;
    }

    if (aborted || vectors.length !== chunks.length) continue;

    for (let i = 0; i < chunks.length; i += 1) {
      await put(STORES.memories, { ...chunks[i], vector: vectors[i], embedder: embedder.tag });
    }
    progress.doneDocs += 1;
    report();
  }

  return { ...progress, cancelled };
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

  // The whole document goes into one space: either every chunk is encoded by
  // the selected encoder, or all of them fall back to hash and are tagged so.
  let embedder = await activeEmbedder();
  let vectorsFinal: number[][];
  try {
    vectorsFinal = await vectorize(
      chunks.map((chunk) => chunk.text),
      embedder,
    );
  } catch {
    embedder = HASH_FALLBACK;
    vectorsFinal = chunks.map((chunk) => hashEmbed(chunk.text));
  }

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
