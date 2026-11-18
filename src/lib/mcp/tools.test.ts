import { describe, expect, it } from 'vitest';
import {
  MCP_VERSION,
  clampResult,
  discoverResult,
  rpc,
  rpcError,
} from './protocol';
import { TOOLS, runTool } from './tools';

describe('mcp protocol', () => {
  it('stamps every result with resultType so strict clients accept it', () => {
    const payload = rpc(1, { tools: [] });
    expect(payload.result.resultType).toBe('complete');
    expect(rpcError(1, -32601, 'no').error.code).toBe(-32601);
  });

  it('advertises supportedVersions, not protocolVersions', () => {
    const result = discoverResult('0.8.0');
    expect(result.supportedVersions).toContain(MCP_VERSION);
    expect(result).not.toHaveProperty('protocolVersions');
    expect(result.ttlMs).toBeGreaterThan(0);
    expect(result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('loomscape');
  });

  it('truncates oversized tool output', () => {
    expect(clampResult('x'.repeat(50), 10)).toHaveLength(11);
  });
});

describe('mcp tools', () => {
  it('exposes four tools with Chinese descriptions and object schemas', () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      'chunk_text',
      'measure_text',
      'title_variants',
      'plan_cursor_actions',
    ]);
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(8);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('chunks text with indices and positions', async () => {
    const result = (await runTool('chunk_text', {
      text: '第一段的内容。\n\n第二段的内容。'.repeat(90),
    })) as { count: number; chunks: Array<{ index: number; text: string }> };
    expect(result.count).toBeGreaterThan(1);
    expect(result.chunks[0].index).toBe(0);
    expect(result.chunks[0].text.length).toBeGreaterThan(0);
  });

  it('measures the same numbers as the chat tool', async () => {
    const result = (await runTool('measure_text', { text: '一二三。四五。' })) as {
      characters: number;
      paragraphs: number;
      readSeconds: number;
    };
    expect(result.characters).toBe(7);
    expect(result.paragraphs).toBe(1);
    expect(result.readSeconds).toBeGreaterThan(0);
  });

  it('clamps the title count to five', async () => {
    const result = (await runTool('title_variants', { subject: '城市夜晚', count: 9 })) as {
      titles: string[];
    };
    expect(result.titles).toHaveLength(5);
  });

  it('plans cursor actions from a plain instruction', async () => {
    const result = (await runTool('plan_cursor_actions', { task: '打开文本创作' })) as {
      steps: number;
      actions: Array<{ action: string }>;
    };
    expect(result.steps).toBeGreaterThan(0);
    expect(result.actions[0].action).toBeTruthy();
  });

  it('refuses empty input and unknown tools', async () => {
    await expect(runTool('measure_text', { text: '   ' })).rejects.toThrow();
    await expect(runTool('nope', {})).rejects.toThrow(/未知工具/);
  });
});
