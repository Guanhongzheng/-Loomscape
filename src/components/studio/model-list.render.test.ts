import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModelGroup } from '@/components/studio/model-list';
import { LOCAL_TEXT, type ModelRuntimeState } from '@/lib/engines';
import type { CacheStats } from '@/lib/local-runtime';

const model = LOCAL_TEXT[0];
const MB = 1024 * 1024;

const runtime = (patch: Partial<ModelRuntimeState> = {}): Record<string, ModelRuntimeState> => ({
  [model.id]: {
    state: 'error',
    progress: 0.68,
    file: 'onnx/model_quantized.onnx',
    loaded: 400 * MB,
    total: 589 * MB,
    message: 'Failed to fetch',
    ...patch,
  },
});

const cache = (files = 0): Record<string, CacheStats> => ({
  [model.id]: { files, bytes: files ? 589 * MB : 0, q8: files > 0, fp16: false, q4f16: false },
});

const render = (patch: {
  runtime?: Record<string, ModelRuntimeState>;
  cache?: Record<string, CacheStats>;
} = {}) =>
  renderToStaticMarkup(
    createElement(ModelGroup, {
      title: '文本模型',
      models: [model],
      accent: true,
      runtime: patch.runtime ?? runtime(),
      cache: patch.cache ?? cache(),
      residents: [],
      backend: 'wasm',
      precision: 'fp16',
      onActivate: async () => undefined,
      onUnload: async () => undefined,
      onDrop: async () => undefined,
      onClearAndRetry: async () => undefined,
    }),
  );

describe('ModelRow failure state', () => {
  it('keeps the interruption point on the card', () => {
    const html = render();
    expect(html).toContain('停在');
    expect(html).toContain('400.0 MB');
    expect(html).toContain('589.0 MB');
    expect(html).toContain('68%');
    expect(html).toContain('重试会从当前文件重新下载');
  });

  it('says the weights landed when only the session failed', () => {
    const html = render({
      runtime: runtime({ progress: 0.99, loaded: 589 * MB }),
    });
    expect(html).toContain('权重已下载完成');
    expect(html).not.toContain('停在');
  });

  it('offers a cache-clearing retry only when something is on disk', () => {
    expect(render()).not.toContain('删除缓存并重试');
    expect(render({ cache: cache(2) })).toContain('删除缓存并重试');
  });

  it('does not promise a resume when no byte count survived', () => {
    const html = render({
      runtime: runtime({ progress: 0, loaded: undefined, total: undefined, file: undefined }),
    });
    expect(html).not.toContain('重试会从当前文件重新下载');
    expect(html).not.toContain('不会整包重下');
  });
});
