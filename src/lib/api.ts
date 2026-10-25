import type { Endpoint } from './providers';

export type GeneratedImage = { dataUrl?: string; url?: string };

export async function requestImages(input: {
  endpoint: Endpoint;
  prompt: string;
  size: string;
  count: number;
}): Promise<GeneratedImage[]> {
  const response = await fetch('/api/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseUrl: input.endpoint.baseUrl,
      apiKey: input.endpoint.apiKey,
      model: input.endpoint.model,
      shape: input.endpoint.shape,
      prompt: input.prompt,
      size: input.size,
      count: input.count,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    images?: GeneratedImage[];
    error?: string;
  };

  if (!response.ok) throw new Error(data.error || `生成失败（${response.status}）`);
  return data.images ?? [];
}

/** Matches the cap `/api/embed` enforces, so one ingest cannot be rejected. */
const EMBED_BATCH = 32;

async function embedBatch(endpoint: Endpoint, input: string[]): Promise<number[][]> {
  const response = await fetch('/api/embed', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      model: endpoint.model,
      input,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    embeddings?: number[][];
    error?: string;
  };

  if (!response.ok) throw new Error(data.error || `嵌入失败（${response.status}）`);
  return data.embeddings ?? [];
}

/**
 * Encodes in batches of 32. A long document used to go out as one request and
 * the route answered 413, which the caller swallowed as "encoder failed" —
 * the chunks were then stored under the API embedder tag with hash vectors and
 * became unreachable. Batching keeps every chunk in the same space.
 */
export async function requestEmbeddings(input: {
  endpoint: Endpoint;
  input: string[];
}): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let index = 0; index < input.input.length; index += EMBED_BATCH) {
    const slice = input.input.slice(index, index + EMBED_BATCH);
    vectors.push(...(await embedBatch(input.endpoint, slice)));
  }
  return vectors;
}

export async function transcribe(input: {
  endpoint: Endpoint;
  blob: Blob;
  filename: string;
}): Promise<string> {
  const form = new FormData();
  form.append('file', input.blob, input.filename);
  form.append('baseUrl', input.endpoint.baseUrl);
  form.append('apiKey', input.endpoint.apiKey);
  form.append('model', input.endpoint.model);

  const response = await fetch('/api/transcribe', { method: 'POST', body: form });
  const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!response.ok) throw new Error(data.error || `转写失败（${response.status}）`);
  return data.text ?? '';
}

/** One short round trip used by the settings panel to prove a key works. */
export async function probeEndpoint(endpoint: Endpoint): Promise<string> {
  const response = await fetch('/api/probe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      model: endpoint.model,
      wire: endpoint.shape,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!response.ok) throw new Error(data.error || `连接失败（${response.status}）`);
  return data.text ?? '';
}

export type Health = { text: boolean; image: boolean; speech: boolean; embedding: boolean };

export async function readHealth(): Promise<Health> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) return { text: false, image: false, speech: false, embedding: false };
    return (await response.json()) as Health;
  } catch {
    return { text: false, image: false, speech: false, embedding: false };
  }
}
