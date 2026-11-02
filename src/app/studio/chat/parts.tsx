'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/field';
import { Panel } from '@/components/studio/workbench';
import { textOf } from '@/components/studio/chat-parts';
import type { Message } from 'ai';
import type { RecallHit } from '@/lib/memory';
import type { ChatSummary, ChatTurn } from '@/lib/chats';
import { usedCitations } from '@/lib/rag';
import { cn } from '@/lib/cn';

export type ChatMode = 'cloud' | 'local' | 'retrieval' | 'calc';

export type Turn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  mode?: ChatMode;
  sources?: RecallHit[];
  tools?: Message;
};

export const SUGGESTIONS = [
  '把这批资料整理成三条要点',
  '用我已经写过的语气，写一段开场',
  '知识库里关于光线的描述有哪些？',
];

export function sourceLabel(hit: RecallHit): string {
  return hit.record.source ? `《${hit.record.source.docTitle}》` : '记忆';
}

/**
 * Sources the answer actually cited stay dark; the rest fade back, so a
 * retrieval hit that the model ignored is visible as such.
 */
export function SourceList({ text, sources }: { text: string; sources: RecallHit[] }) {
  const cited = new Set(usedCitations(text, sources.length));
  return (
    <ol className="space-y-1">
      {sources.map((hit, index) => {
        const used = cited.has(index + 1);
        return (
          <li
            key={hit.record.id}
            className={cn(
              'flex gap-2 text-[11px] leading-relaxed',
              used ? 'text-muted' : 'text-muted/55',
            )}
          >
            <span
              className={cn(
                'mt-px shrink-0 font-mono text-[10px]',
                used ? 'text-[rgb(var(--copper))]' : 'text-muted/40',
              )}
            >
              [{index + 1}]
            </span>
            <span className="min-w-0">
              <span className={used ? 'text-ink/75' : 'text-ink/45'}>{sourceLabel(hit)}</span>
              <span className="ml-1.5">
                {hit.record.text.replace(/\s+/g, ' ').slice(0, 54)}…
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function retrievalAnswer(hits: RecallHit[]): string {
  if (!hits.length) {
    return '本地知识库里没有找到相关片段。可以在右侧导入资料，或先在设置里连接一个模型端点。';
  }
  const lines = hits.map((hit, index) => {
    const position = hit.record.source
      ? ` 片段 ${hit.record.source.chunk + 1}/${hit.record.source.total}`
      : '';
    return `[${index + 1}] ${sourceLabel(hit)}${position}\n${hit.record.text.slice(0, 220)}`;
  });
  return ['未配置模型，先给出检索结果（按相关度排序）：', ...lines].join('\n\n');
}

/**
 * Turns the SDK transcript into one bubble per exchange. With tools enabled a
 * single answer arrives as several assistant messages (text, tool call, text);
 * rendering each as its own bubble looked like the reply repeated itself.
 */
export function cloudTurns(messages: Message[], sources: Map<number, RecallHit[]>): Turn[] {
  const out: Turn[] = [];
  let asked = 0;

  for (const message of messages) {
    const text = textOf(message).trim();
    const isTool = (message.parts ?? []).some((part) => part.type === 'tool-invocation');

    if (message.role !== 'assistant') {
      asked += 1;
      out.push({
        id: message.id,
        role: 'user',
        text,
        at: (message.createdAt ?? new Date()).getTime(),
      });
      continue;
    }

    const previous = out[out.length - 1];
    if (previous && previous.role === 'assistant') {
      if (text) previous.text = previous.text ? `${previous.text}\n\n${text}` : text;
      previous.tools = message;
      continue;
    }

    if (!text && !isTool) continue;

    out.push({
      id: message.id,
      role: 'assistant',
      text,
      at: (message.createdAt ?? new Date()).getTime(),
      mode: 'cloud',
      tools: message,
      sources: sources.get(asked - 1),
    });
  }

  return out;
}

/**
 * Retrieval hits are stored on the answer, but the rail indexes them by
 * exchange number, so a restored transcript rebuilds the same map instead of
 * showing answers without their sources.
 */
export function sourcesOf(turns: ChatTurn[]): Map<number, RecallHit[]> {
  const out = new Map<number, RecallHit[]>();
  let asked = 0;
  for (const turn of turns) {
    if (turn.role === 'user') asked += 1;
    else if (turn.sources?.length) out.set(Math.max(asked - 1, 0), turn.sources);
  }
  return out;
}

export function timeAgo(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/**
 * The saved-session rail. Purely presentational: renaming has two pieces of
 * state (which row is open, what has been typed) and the page owns both, so a
 * row cannot start editing itself while another is still open.
 */
export function ChatSessionPanel({
  sessions,
  activeId,
  editing,
  draft,
  onDraftChange,
  onOpen,
  onNew,
  onCommit,
  onCancel,
  onBeginRename,
  onDelete,
}: {
  sessions: ChatSummary[];
  activeId: string;
  editing: boolean;
  draft: string;
  onDraftChange: (next: string) => void;
  onOpen: (id: string) => Promise<void> | void;
  onNew: () => Promise<void> | void;
  onCommit: () => void;
  onCancel: () => void;
  onBeginRename: (row: ChatSummary) => void;
  onDelete: (id: string) => Promise<void> | void;
}) {
  return (
    <Panel
      title="会话"
      hint={sessions.length ? `${sessions.length} 个` : '刷新后仍在'}
      action={
        <button
          type="button"
          onClick={() => void onNew()}
          className="flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-ink"
        >
          <Plus size={12} />
          新建
        </button>
      }
    >
      {sessions.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted/70">
          发送第一条消息后自动保存。刷新页面、换工作台回来，都能接着上次的对话。
        </p>
      ) : (
        <ul className="space-y-1.5">
          {sessions.map((row) => {
            const active = row.id === activeId;
            return (
              <li
                key={row.id}
                data-session={row.id}
                data-active={active ? 'true' : 'false'}
                className={cn(
                  'group flex items-start gap-1.5 rounded-xl px-3 py-2',
                  active ? 'shadow-[var(--shadow-inset-sm)]' : 'hover:bg-[rgb(var(--sunken))]',
                )}
              >
                {editing && active ? (
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(event) => onDraftChange(event.target.value)}
                    onBlur={onCommit}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onCommit();
                      if (event.key === 'Escape') onCancel();
                    }}
                    className="h-7 text-[11.5px]"
                    aria-label="会话标题"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => void onOpen(row.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-[11.5px] text-ink/85">{row.title}</div>
                    <div className="font-mono text-[9.5px] text-muted/55">
                      {timeAgo(row.updatedAt)} · {row.turns} 轮
                    </div>
                  </button>
                )}

                {active && !editing ? (
                  <button
                    type="button"
                    aria-label="重命名会话"
                    onClick={() => onBeginRename(row)}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-muted/50 transition-colors hover:bg-[rgb(var(--sunken))] hover:text-ink"
                  >
                    <Pencil size={11} />
                  </button>
                ) : null}

                <button
                  type="button"
                  aria-label={`删除 ${row.title}`}
                  onClick={() => void onDelete(row.id)}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-muted/50 transition-colors hover:bg-[rgb(var(--sunken))] hover:text-ink"
                >
                  <Trash2 size={11} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
