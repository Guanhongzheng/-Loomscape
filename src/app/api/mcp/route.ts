import type { NextRequest } from 'next/server';
import {
  MCP_LEGACY_VERSION,
  MCP_VERSION,
  METHOD_NOT_FOUND,
  TOOL_FAILED,
  UNSUPPORTED_VERSION,
  clampResult,
  discoverResult,
  rpc,
  rpcError,
  type JsonRpcRequest,
} from '@/lib/mcp/protocol';
import { TOOLS, findTool, runTool } from '@/lib/mcp/tools';
import { jsonError, originAllowed } from '@/lib/server/upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.8.0';

const KNOWN_VERSIONS = [MCP_VERSION, MCP_LEGACY_VERSION];

/**
 * 织境 as an MCP server.
 *
 * Only pure functions live here: the tools never touch memories, projects or
 * chats, so a caller cannot read user data through this surface. Following the
 * 2026-07-28 revision the endpoint is stateless — no handshake, no session id —
 * while `initialize` is still answered so older clients keep working.
 */
export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return jsonError('来源不被允许', 403);

  const body = (await request.json().catch(() => null)) as JsonRpcRequest | null;
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return jsonError('请求体不是合法 JSON-RPC 2.0', 400);
  }

  const method = (request.headers.get('mcp-method') ?? body.method).trim();
  const id = body.id;

  // A header that names a version we do not speak is a hard error in this
  // revision; a missing header is fine, because the body may carry it in _meta.
  const versionHeader = request.headers.get('mcp-protocol-version')?.trim();
  if (versionHeader && !KNOWN_VERSIONS.includes(versionHeader)) {
    return Response.json({
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code: UNSUPPORTED_VERSION,
        message: 'Unsupported protocol version',
        data: { supported: KNOWN_VERSIONS, requested: versionHeader },
      },
    });
  }

  switch (method) {
    case 'server/discover':
      return Response.json(rpc(id, discoverResult(VERSION)));

    case 'tools/list':
      return Response.json(
        rpc(id, { tools: TOOLS, ttlMs: 60_000, cacheScope: 'public' }),
      );

    case 'tools/call': {
      const params = (body.params ?? {}) as { name?: unknown; arguments?: unknown };
      const name = String(params.name ?? '');
      const args =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
      const tool = findTool(name);
      if (!tool) return Response.json(rpcError(id, METHOD_NOT_FOUND, `未知工具：${name}`));
      try {
        const text = clampResult(await runTool(name, args), 4000);
        return Response.json(rpc(id, { content: [{ type: 'text', text }] }));
      } catch (error) {
        return Response.json(
          rpcError(id, TOOL_FAILED, error instanceof Error ? error.message : '工具执行失败'),
        );
      }
    }

    // Legacy handshake (2025-11-25 and earlier). Kept so Claude Desktop and the
    // installed SDKs can still connect; the new revision never sends this.
    case 'initialize':
      return Response.json(
        rpc(id, {
          protocolVersion: MCP_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'loomscape', version: VERSION },
        }),
      );

    case 'notifications/initialized':
      return new Response(null, { status: 202 });

    default:
      return Response.json(rpcError(id, METHOD_NOT_FOUND, `未实现的方法：${method}`));
  }
}

/** The 2026-07-28 transport dropped the GET stream; say so instead of 404. */
export function GET() {
  return jsonError('该端点只接受 POST（MCP 2026-07-28 已移除 GET 流）', 405);
}
