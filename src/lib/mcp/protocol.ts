/**
 * MCP wire types for the 2026-07-28 revision.
 *
 * That revision dropped the initialize/initialized handshake and the
 * Mcp-Session-Id header: every request is self-describing, and every result
 * must carry `resultType`. Getting the field names right matters more than
 * usual here — a strict client rejects the whole response over `protocolVersions`
 * versus `supportedVersions`.
 */
export const MCP_VERSION = '2026-07-28';

/** Previous stateless-by-handshake revision, still spoken by most clients. */
export const MCP_LEGACY_VERSION = '2025-11-25';

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpTextContent = { type: 'text'; text: string };

export type McpToolResult = {
  resultType: 'complete';
  content: McpTextContent[];
};

/** Every result carries `resultType: "complete"` unless a caller sets another. */
export function rpc(id: JsonRpcId | undefined, result: Record<string, unknown>) {
  return {
    jsonrpc: '2.0' as const,
    id: id ?? null,
    result: { resultType: 'complete', ...result },
  };
}

export function rpcError(id: JsonRpcId | undefined, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } };
}

/** -32022: the version this request asked for is not supported. */
export const UNSUPPORTED_VERSION = -32022;
export const METHOD_NOT_FOUND = -32601;
export const TOOL_FAILED = -32000;

/** Keeps a tool from stuffing an entire document into the model's context. */
export function clampResult(value: unknown, max = 8000): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function discoverResult(version: string) {
  return {
    supportedVersions: [MCP_VERSION, MCP_LEGACY_VERSION],
    capabilities: { tools: {} },
    _meta: {
      'io.modelcontextprotocol/serverInfo': { name: 'loomscape', version },
    },
    instructions:
      '织境的本地文本工具：切块、字数、标题备选、光标动作规划。只处理纯文本，不读写用户资料。',
    ttlMs: 3_600_000,
    cacheScope: 'public',
  };
}
