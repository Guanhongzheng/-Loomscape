import type { Endpoint } from './providers';

export type ChatRole = 'system' | 'user' | 'assistant';
export type ChatMessage = { role: ChatRole; content: string };

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

type ChatOptions = {
  endpoint: Endpoint;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
};

/** Streams a completion from the server-side relay and yields plain text deltas. */
export async function streamChat({ endpoint, messages, temperature, maxTokens, signal, onDelta }: ChatOptions) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      model: endpoint.model,
      shape: endpoint.shape,
      messages,
      temperature,
      maxTokens,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `请求失败（${response.status}）`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let produced = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const event = JSON.parse(payload) as StreamEvent;
          if (event.type === 'delta') {
            produced += event.text;
            onDelta(event.text);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
    }
  }

  return produced;
}

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

export type Health = { text: boolean; image: boolean; speech: boolean };

export async function readHealth(): Promise<Health> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) return { text: false, image: false, speech: false };
    return (await response.json()) as Health;
  } catch {
    return { text: false, image: false, speech: false };
  }
}
