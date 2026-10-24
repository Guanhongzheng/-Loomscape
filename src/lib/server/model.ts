import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

export type Wire = 'openai-chat' | 'anthropic-chat' | 'google-chat';

/**
 * Each family speaks a different protocol, so the relay picks the matching
 * provider instead of pretending everything is OpenAI-compatible.
 */
export function buildLanguageModel(config: {
  baseUrl: string;
  apiKey: string;
  model: string;
  wire?: string;
}): LanguageModel {
  const wire = (config.wire ?? 'openai-chat') as Wire;

  if (wire === 'anthropic-chat') {
    const provider = createAnthropic({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
    return provider(config.model);
  }

  if (wire === 'google-chat') {
    const provider = createGoogleGenerativeAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
    return provider(config.model);
  }

  const provider = createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    compatibility: 'compatible',
  });
  return provider(config.model);
}
