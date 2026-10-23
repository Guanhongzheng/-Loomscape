'use client';

import { STORES, all, put } from './db';

export type Channel = 'text' | 'image' | 'speech';

export type WireShape = 'openai-chat' | 'openai-image' | 'stability' | 'openai-audio';

export type Endpoint = {
  channel: Channel;
  preset: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  shape: WireShape;
  updatedAt: number;
};

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
      id: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      shape: 'openai-chat',
    },
    {
      id: 'zhipu',
      label: '智谱 GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['glm-4-plus', 'glm-4-air', 'glm-4v-plus'],
      shape: 'openai-chat',
    },
    {
      id: 'moonshot',
      label: 'Moonshot',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v1-32k', 'moonshot-v1-8k'],
      shape: 'openai-chat',
    },
    {
      id: 'dashscope',
      label: '通义千问',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-max', 'qwen-vl-plus'],
      shape: 'openai-chat',
    },
    {
      id: 'custom',
      label: '自建 / 兼容端点',
      baseUrl: '',
      models: [],
      shape: 'openai-chat',
      note: '任何兼容 /chat/completions 的服务都可接入',
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
  speech: [
    {
      id: 'openai-audio',
      label: 'OpenAI Whisper',
      baseUrl: 'https://api.openai.com/v1',
      models: ['whisper-1'],
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
    rows.forEach((row) => {
      if (!row.channel) return;
      const merged = { ...EMPTY_ENDPOINTS[row.channel], ...row };
      // keep the preset address when a stored row was saved before a provider was chosen
      if (!merged.baseUrl.trim()) {
        merged.baseUrl = presetFor(row.channel, merged.preset)?.baseUrl ?? '';
      }
      result[row.channel] = merged;
    });
  } catch {
    // storage unavailable — defaults already represent the offline state
  }
  return result;
}

export async function saveEndpoint(endpoint: Endpoint): Promise<void> {
  await put(STORES.providers, { ...endpoint, updatedAt: Date.now() });
}
