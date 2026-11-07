'use client';

import { Database, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/studio/workbench';
import { RichText } from '@/components/studio/rich-text';
import { ToolBadges } from '@/components/studio/chat-parts';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { SUGGESTIONS, SourceList, type Turn } from './parts';

const MODE_LABEL: Record<NonNullable<Turn['mode']>, string> = {
  retrieval: 'retrieval only',
  calc: 'calculator',
  local: 'local runtime',
  cloud: 'ai sdk stream',
};

/**
 * The transcript, from the empty state to the scroll anchor. It owns no state:
 * the send pipeline lives on the page, and this only decides how a turn looks —
 * including the skeleton that stands in for an answer that has not started.
 */
export function Transcript({
  turns,
  busy,
  error,
  bottomRef,
  onSuggestion,
}: {
  turns: Turn[];
  busy: boolean;
  error?: Error;
  bottomRef: React.RefObject<HTMLDivElement>;
  onSuggestion: (text: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
      <div className="mx-auto w-full max-w-[880px]">
        {turns.length === 0 ? (
          <EmptyState
            title="问点什么"
            description="开启记忆检索后，回答会先查本地知识库，并在句末标出引用的片段编号。"
            action={
              <div className="flex flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => onSuggestion(item)}
                    className="rounded-full border border-white/60 bg-white/40 px-3 py-1.5 text-[11.5px] text-muted shadow-[var(--shadow-neu-sm)] backdrop-blur-md transition-colors hover:border-white/80 hover:text-ink"
                  >
                    {item}
                  </button>
                ))}
              </div>
            }
          />
        ) : (
          <div className="space-y-7">
            {turns.map((turn) => (
              <article
                key={turn.id}
                data-turn={turn.role}
                className={cn(turn.role === 'user' ? 'flex flex-col items-end' : undefined)}
              >
                {turn.role === 'user' ? (
                  <>
                    <p className="max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[rgb(var(--accent))] px-4 py-3 text-[13.5px] leading-[1.75] text-[rgb(var(--surface))] shadow-[var(--shadow-accent)]">
                      {turn.text}
                    </p>
                    <span className="mt-1.5 pr-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted/60">
                      {new Date(turn.at).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </>
                ) : (
                  <>
                    <div className="rounded-2xl border border-white/60 bg-white/45 px-4 py-4 shadow-[var(--shadow-neu-sm)] backdrop-blur-xl md:px-5">
                      {turn.text ? (
                        <RichText text={turn.text} />
                      ) : (
                        <div className="space-y-2.5 py-1">
                          <div className="skeleton h-3 w-[86%] rounded-full" />
                          <div className="skeleton h-3 w-[72%] rounded-full" />
                          <div className="skeleton h-3 w-[79%] rounded-full" />
                        </div>
                      )}
                    </div>

                    {turn.tools ? <ToolBadges message={turn.tools} /> : null}

                    {turn.sources?.length ? (
                      <div className="mt-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted/60">
                          <Database size={11} />
                          {turn.sources.length} 条来源
                        </div>
                        <SourceList text={turn.text} sources={turn.sources} />
                      </div>
                    ) : null}

                    <div className="mt-3 flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted/55">
                        {MODE_LABEL[turn.mode ?? 'cloud']}
                      </span>
                      {turn.text ? (
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(turn.text)
                              .then(() => toast('已复制', 'success'))
                              .catch(() => toast('无法访问剪贴板', 'error'));
                          }}
                          className="ml-auto rounded-lg px-2 py-1 text-[11.5px] text-muted transition-colors hover:bg-[rgb(var(--sunken))]/70 hover:text-ink"
                        >
                          复制
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </article>
            ))}

            {busy && !turns.some((turn) => turn.role === 'assistant' && !turn.text) ? (
              <div className="flex items-center gap-2 text-[11.5px] text-muted">
                <Loader2 size={12} className="animate-spin" />
                正在生成，可随时停止
              </div>
            ) : null}

            {error ? (
              <p className="rounded-xl border border-[#8c3b32]/20 bg-[#f3e2df] px-3.5 py-2.5 text-[12px] text-[#8c3b32]">
                {error.message}
              </p>
            ) : null}

            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
