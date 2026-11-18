'use client';

import { STORES, all, put } from './db';
import { isSealed, openSecret, sealSecret } from './vault';

export type Channel = 'text' | 'image' | 'speech' | 'embedding';

export type WireShape =
  | 'openai-chat'
  | 'anthropic-chat'
  | 'google-chat'
  | 'openai-image'
  | 'stability'
  | 'openai-audio'
  | 'openai-embedding';

export type Endpoint = {
  channel: Channel;
  preset: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  shape: WireShape;
  updatedAt: number;
  /** The stored key is encrypted and the vault is locked; never persisted. */
  sealed?: boolean;
  /**
   * Optional model used when the message carries an image. Shares baseUrl and
   * apiKey with `model`; left empty, a vision-capable `model` is used as-is.
   */
  visionModel?: string;
};

/**
 * A cheap capability guess. It exists so someone who already runs gpt-4o does
 * not have to type a vision model before the paperclip works; it is never used
 * to block a request that names one explicitly.
 */
const VISION_MODEL =
  /gpt-4o(?!-tts)|gpt-4\.1|gpt-5|gemini|qwen.*vl|glm-4v|claude-(3|4)|doubao.*vision|internvl|llava/i;
const AUDIO_ONLY = /tts|audio|transcribe|embedding|rerank/i;

export function looksVisionCapable(model: string): boolean {
  const id = model.trim();
  if (!id || AUDIO_ONLY.test(id)) return false;
  return VISION_MODEL.test(id);
}

type Preset = {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
  shape: WireShape;
  note?: string;
};

export const PRESETS: Record<Channel, Preset[]> = {
  text: [
    {
      id: 'openai',
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o', 'o4-mini'],
      shape: 'openai-chat',
    },
    {
      id: 'anthropic',
      label: 'Anthropic Claude',
      baseUrl: 'https://api.anthropic.com/v1',
      models: ['claude-sonnet-4-5', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
      shape: 'anthropic-chat',
      note: 'Messages API，支持工具调用',
    },
    {
      id: 'google',
      label: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
      shape: 'google-chat',
    },
    {
      id: 'zhipu',
      label: '智谱 AI',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
      shape: 'openai-chat',
    },
    {
      id: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      shape: 'openai-chat',
    },
    {
      id: 'custom',
      label: '自建 / 兼容端点',
      baseUrl: '',
      models: [],
      shape: 'openai-chat',
      note: '任何兼容 /chat/completions 的服务',
    },
  ],
  image: [
    {
      id: 'openai-image',
      label: 'OpenAI Images',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-image-1', 'dall-e-3'],
      shape: 'openai-image',
    },
    {
      id: 'siliconflow-image',
      label: '硅基流动 SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      models: ['black-forest-labs/FLUX.1-schnell', 'Kwai-Kolors/Kolors'],
      shape: 'openai-image',
      note: '国内直连；FLUX 与 Kolors 都走 /images/generations',
    },
    {
      id: 'zhipu-image',
      label: '智谱 CogView',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['cogview-4', 'cogview-4-flash'],
      shape: 'openai-image',
    },
    {
      id: 'ark-image',
      label: '火山方舟 · 豆包 Seedream',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      models: ['doubao-seedream-3-0-t2i-250415'],
      shape: 'openai-image',
      note: '模型处填控制台里的推理接入点 ID',
    },
    {
      id: 'hunyuan-image',
      label: '腾讯混元 生图',
      baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
      models: ['hy-image-v3'],
      shape: 'openai-image',
    },
    {
      id: 'stability',
      label: 'Stability AI',
      baseUrl: 'https://api.stability.ai',
      models: ['sd3.5-large', 'sd3.5-large-turbo', 'core'],
      shape: 'stability',
    },
    {
      id: 'custom-image',
      label: '自建 / 兼容端点',
      baseUrl: '',
      models: [],
      shape: 'openai-image',
    },
  ],
  embedding: [
    {
      id: 'dashscope-embedding',
      label: '通义千问 Embedding',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['text-embedding-v3', 'text-embedding-v4'],
      shape: 'openai-embedding',
      note: '国内直连，1024 维，适合中文作品库',
    },
    {
      id: 'siliconflow-embedding',
      label: '硅基流动 SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      models: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5'],
      shape: 'openai-embedding',
      note: 'bge 系列有免费额度，适合本地作品库',
    },
    {
      id: 'zhipu-embedding',
      label: '智谱 Embedding',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['embedding-3'],
      shape: 'openai-embedding',
    },
    {
      id: 'jina-embedding',
      label: 'Jina AI',
      baseUrl: 'https://api.jina.ai/v1',
      models: ['jina-embeddings-v3'],
      shape: 'openai-embedding',
      note: '多语言，有免费额度',
    },
    {
      id: 'hunyuan-embedding',
      label: '腾讯混元 Embedding',
      baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
      models: ['hunyuan-embedding'],
      shape: 'openai-embedding',
    },
    {
      id: 'openai-embedding',
      label: 'OpenAI Embedding',
      baseUrl: 'https://api.openai.com/v1',
      models: ['text-embedding-3-small', 'text-embedding-3-large'],
      shape: 'openai-embedding',
    },
    {
      id: 'custom-embedding',
      label: '自建 / 兼容端点',
      baseUrl: '',
      models: [],
      shape: 'openai-embedding',
    },
  ],
  speech: [
    {
      id: 'openai-audio',
      label: 'OpenAI Whisper',
      baseUrl: 'https://api.openai.com/v1',
      models: ['whisper-1', 'gpt-4o-transcribe'],
      shape: 'openai-audio',
    },
    {
      id: 'groq-audio',
      label: 'Groq Whisper',
      baseUrl: 'https://api.groq.com/openai/v1',
      models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
      shape: 'openai-audio',
      note: '速度最快，有免费额度',
    },
    {
      id: 'siliconflow-audio',
      label: '硅基流动 SenseVoice',
      baseUrl: 'https://api.siliconflow.cn/v1',
      models: ['FunAudioLLM/SenseVoiceSmall'],
      shape: 'openai-audio',
      note: '中文识别好，兼容 /audio/transcriptions',
    },
    {
      id: 'deepinfra-audio',
      label: 'DeepInfra Whisper',
      baseUrl: 'https://api.deepinfra.com/v1/openai',
      models: ['openai/whisper-large-v3'],
      shape: 'openai-audio',
    },
    {
      id: 'custom-audio',
      label: '自建 / 兼容端点',
      baseUrl: '',
      models: [],
      shape: 'openai-audio',
    },
  ],
};

export const EMPTY_ENDPOINTS: Record<Channel, Endpoint> = {
  text: {
    channel: 'text',
    preset: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    shape: 'openai-chat',
    updatedAt: 0,
    visionModel: '',
  },
  image: {
    channel: 'image',
    preset: 'openai-image',
    label: 'OpenAI Images',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-image-1',
    shape: 'openai-image',
    updatedAt: 0,
  },
  embedding: {
    channel: 'embedding',
    preset: 'dashscope-embedding',
    label: '通义千问 Embedding',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    model: 'text-embedding-v3',
    shape: 'openai-embedding',
    updatedAt: 0,
  },
  speech: {
    channel: 'speech',
    preset: 'openai-audio',
    label: 'OpenAI Whisper',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'whisper-1',
    shape: 'openai-audio',
    updatedAt: 0,
  },
};

export function presetFor(channel: Channel, id: string): Preset | undefined {
  return PRESETS[channel].find((item) => item.id === id);
}

export function hasKey(endpoint: Endpoint): boolean {
  return endpoint.apiKey.trim().length > 8 && endpoint.baseUrl.trim().length > 0;
}

export async function loadEndpoints(): Promise<Record<Channel, Endpoint>> {
  const result = { ...EMPTY_ENDPOINTS };
  try {
    const rows = await all<Endpoint>(STORES.providers);
    for (const row of rows) {
      if (!row.channel) continue;
      const merged = { ...EMPTY_ENDPOINTS[row.channel], ...row };
      // keep the preset address when a stored row was saved before a provider was chosen
      if (!merged.baseUrl.trim()) {
        merged.baseUrl = presetFor(row.channel, merged.preset)?.baseUrl ?? '';
      }
      // A sealed key needs the passphrase; while locked it reads as empty, and
      // the settings card says why instead of pretending nothing was saved.
      const sealed = isSealed(merged.apiKey ?? '');
      merged.apiKey = await openSecret(merged.apiKey ?? '');
      merged.sealed = sealed && merged.apiKey === '';
      result[row.channel] = merged;
    }
  } catch {
    // storage unavailable — defaults already represent the offline state
  }
  return result;
}

/**
 * The store is keyed by channel, so a record without one cannot be written.
 * Callers build endpoints from the preset table, which always sets it; this
 * guard keeps a hand-built record from failing deep inside IndexedDB.
 */
export async function saveEndpoint(endpoint: Endpoint): Promise<void> {
  if (!endpoint.channel) throw new Error('端点缺少渠道标识，无法保存');
  await put(STORES.providers, {
    ...endpoint,
    baseUrl: endpoint.baseUrl.trim(),
    // Sealed when the vault is on; throws while it is locked, so a save can
    // never silently downgrade the stored key to plaintext.
    apiKey: await sealSecret(endpoint.apiKey.trim()),
    model: endpoint.model.trim(),
    updatedAt: Date.now(),
  });
}
