'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { Message } from 'ai';
import {
  ArrowUp,
  BookPlus,
  Database,
  FileText,
  Loader2,
  Sparkle,
  Square,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/field';
import { Switch } from '@/components/ui/controls';
import { ChannelBadge, EmptyState, Panel, WorkbenchHeader } from '@/components/studio/workbench';
import { RichText } from '@/components/studio/rich-text';
import { ToolBadges, textOf } from '@/components/studio/chat-parts';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { channelReady, useEndpoints } from '@/lib/endpoint-store';
import { findModel, useEngines } from '@/lib/engines';
import { streamLocal } from '@/lib/local-runtime';
import {
  activeEmbedder,
  forgetDocument,
  listDocuments,
  readMemoryPrefs,
  remember,
  rememberDocument,
  retrieve,
  toRagSources,
  type DocumentSummary,
  type EmbedderInfo,
  type RecallHit,
} from '@/lib/memory';
import { composeRagContext, systemPrompt as buildSystem, usedCitations } from '@/lib/rag';
import { solveArithmetic } from '@/lib/arithmetic';
import { cn } from '@/lib/cn';

type ChatMode = 'cloud' | 'local' | 'retrieval' | 'calc';

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  mode?: ChatMode;
  sources?: RecallHit[];
  tools?: Message;
};

const SUGGESTIONS = [
  '把这批资料整理成三条要点',
  '用我已经写过的语气，写一段开场',
  '知识库里关于光线的描述有哪些？',
];

function sourceLabel(hit: RecallHit): string {
  return hit.record.source ? `《${hit.record.source.docTitle}》` : '记忆';
}

/**
 * Sources the answer actually cited stay dark; the rest fade back, so a
 * retrieval hit that the model ignored is visible as such.
 */
function SourceList({ text, sources }: { text: string; sources: RecallHit[] }) {
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

function retrievalAnswer(hits: RecallHit[]): string {
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
function cloudTurns(messages: Message[], sources: Map<number, RecallHit[]>): Turn[] {
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
      tools: message,
      sources: sources.get(asked - 1),
    });
  }

  return out;
}

export default function ChatWorkbench() {
  const { user } = useAuth();
  const endpoints = useEndpoints((state) => state.endpoints);
  const health = useEndpoints((state) => state.health);
  const live = channelReady({ endpoints, health }, 'text');

  const prefs = useEngines((state) => state.prefs);
  const loadEngines = useEngines((state) => state.load);

  const [input, setInput] = useState('');
  const [localTurns, setLocalTurns] = useState<Turn[]>([]);
  const [localBusy, setLocalBusy] = useState(false);
  const [ragOn, setRagOn] = useState(true);
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [embedder, setEmbedder] = useState<EmbedderInfo | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [importing, setImporting] = useState(false);
  const [cloudSources, setCloudSources] = useState<Map<number, RecallHit[]>>(new Map());

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingContext = useRef('');
  // Retrieval is awaited before the transcript updates, so a fast double Enter
  // used to send the same question twice and the model answered its own echo.
  const sending = useRef(false);

  const owner = user?.id ?? 'local';
  const localMode = prefs.textMode === 'local';
  const localModel = findModel(prefs.textModelId);

  const { messages, append, stop, status, setMessages, error } = useChat({
    api: '/api/chat',
    maxSteps: 3,
    experimental_prepareRequestBody: ({ messages: current }) => ({
      messages: current,
      system: buildSystem(pendingContext.current),
      temperature: 0.7,
      maxTokens: 1400,
      baseUrl: endpoints.text.baseUrl,
      apiKey: endpoints.text.apiKey,
      model: endpoints.text.model,
      wire: endpoints.text.shape,
    }),
    onError: (err) => toast(err.message, 'error'),
  });

  useEffect(() => {
    void loadEngines();
    void readMemoryPrefs().then((value) => setRagOn(value.enabled));
    void activeEmbedder().then(setEmbedder);
  }, [loadEngines]);

  const refreshDocs = () => {
    if (!user) return;
    listDocuments(user.id)
      .then(setDocs)
      .catch(() => setDocs([]));
  };

  useEffect(refreshDocs, [user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, localTurns.length]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Finished answers become memory: that is the persistent artefact here,
  // the transcript itself stays in the tab.
  const remembered = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (status !== 'ready' || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'assistant' || remembered.current.has(last.id)) return;
    const text = textOf(last).trim();
    if (!text) return;
    remembered.current.add(last.id);
    void remember({ owner, kind: 'note', text: text.slice(0, 400), tags: ['chat'] });
  }, [messages, status, owner]);

  const busy = localMode ? localBusy : status === 'submitted' || status === 'streaming';

  const send = async () => {
    const text = input.trim();
    if (!text || busy || sending.current) return;
    sending.current = true;

    // Deterministic input should not be sampled: a 0.5B reads "10-3" as 10.3
    // often enough that arithmetic is answered here and everywhere else still
    // goes to the model.
    if (localMode) {
      const calc = solveArithmetic(text);
      if (calc) {
        const id = `calc_${Date.now()}`;
        setLocalTurns((rows) => [
          ...rows,
          { id, role: 'user', text, at: Date.now() },
          {
            id: `${id}_a`,
            role: 'assistant',
            text: `${calc.expression} = ${calc.result}`,
            at: Date.now(),
            mode: 'calc',
          },
        ]);
        setInput('');
        sending.current = false;
        return;
      }
    }

    const hits = ragOn
      ? await retrieve(text, owner, {
          topK: 4,
          // 'note' is where finished answers are stored. Feeding them back as
          // sources made the model quote itself, which read as repetition.
          kinds: ['doc', 'text', 'story', 'voice'],
        })
      : [];
    const context = composeRagContext(toRagSources(hits));
    setInput('');

    if (localMode) {
      const model = localModel;
      if (!model) {
        toast('设置里还没有选择本地模型', 'error');
        sending.current = false;
        return;
      }
      const id = `local_${Date.now()}`;
      const answerId = `${id}_a`;
      setLocalTurns((rows) => [
        ...rows,
        { id, role: 'user', text, at: Date.now() },
        { id: answerId, role: 'assistant', text: '', at: Date.now(), mode: 'local', sources: hits },
      ]);
      setLocalBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const system = buildSystem(context, true);
      // The local path used to send only the newest message, so a follow-up
      // question arrived with no conversation behind it.
      const history = localTurns
        .filter((turn) => turn.text.trim())
        .slice(-6)
        .map((turn) => ({ role: turn.role, content: turn.text.slice(0, 800) }));

      let produced = '';
      try {
        await streamLocal({
          model,
          source: prefs.source,
          backendPreference: prefs.backend,
          system,
          turns: [...history, { role: 'user', content: text }],
          maxTokens: 240,
          temperature: 0.3,
          signal: controller.signal,
          onToken: (chunk) => {
            produced += chunk;
            setLocalTurns((rows) =>
              rows.map((row) => (row.id === answerId ? { ...row, text: produced } : row)),
            );
          },
        });
        if (produced.trim()) {
          void remember({ owner, kind: 'note', text: produced.slice(0, 400), tags: ['chat', 'local'] });
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : '本地生成失败', 'error');
      } finally {
        setLocalBusy(false);
        sending.current = false;
      }
      return;
    }

    if (!live) {
      const id = `ret_${Date.now()}`;
      const answer = retrievalAnswer(hits);
      setLocalTurns((rows) => [
        ...rows,
        { id, role: 'user', text, at: Date.now() },
        {
          id: `${id}_a`,
          role: 'assistant',
          text: answer,
          at: Date.now(),
          mode: 'retrieval',
          sources: hits,
        },
      ]);
      sending.current = false;
      return;
    }

    const pair = messages.filter((message) => message.role === 'user').length;
    if (hits.length) {
      setCloudSources((rows) => new Map(rows).set(pair, hits));
    }
    pendingContext.current = context;
    try {
      await append({ role: 'user', content: text });
    } finally {
      sending.current = false;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    stop();
    setLocalBusy(false);
  };

  const reset = () => {
    cancel();
    setMessages([]);
    setLocalTurns([]);
    setCloudSources(new Map());
    remembered.current.clear();
  };

  const importDoc = async () => {
    if (!note.trim()) {
      toast('先粘贴一些内容', 'error');
      return;
    }
    setImporting(true);
    try {
      const summary = await rememberDocument({
        owner,
        title,
        text: note,
      });
      setDocs((rows) => [summary, ...rows]);
      setTitle('');
      setNote('');
      setEmbedder(await activeEmbedder());
      toast(`已入库：${summary.chunks} 段`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '入库失败', 'error');
    } finally {
      setImporting(false);
    }
  };

  const dropDoc = async (docId: string) => {
    await forgetDocument(owner, docId);
    setDocs((rows) => rows.filter((row) => row.docId !== docId));
    toast('已移除该资料', 'success');
  };

  // Cloud replies must win once they exist: the old condition kept showing the
  // local transcript (or an earlier retrieval-only exchange) after the engine
  // was switched, so the new answers were invisible.
  const cloudView = cloudTurns(messages, cloudSources);
  const turns: Turn[] = localMode ? localTurns : cloudView.length ? cloudView : localTurns;

  // A stored model name without a key would claim an engine that never runs.
  const engineLabel = localMode
    ? `本地 · ${localModel?.label ?? '未选择模型'}`
    : live
      ? `云端 · ${endpoints.text.model}`
      : '云端 · 未配置';

  return (
    <div>
      <WorkbenchHeader
        index="02"
        title="对话"
        description="先检索本地知识库，再把命中的片段交给模型。云端走 AI SDK 流式，本地模型在浏览器内推理；引用编号可以直接对回来源。"
        actions={<ChannelBadge channel="text" />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          className="flex h-[calc(100dvh-21rem)] min-h-[420px] flex-col md:h-[calc(100dvh-18.5rem)] md:min-h-[520px]"
          bodyClassName="flex min-h-0 flex-1 flex-col p-0"
          title="对话"
          hint={`${turns.filter((turn) => turn.role === 'assistant').length} 轮`}
          action={
            turns.length ? (
              <button
                type="button"
                onClick={reset}
                className="text-[11px] text-muted transition-colors hover:text-ink"
              >
                清空
              </button>
            ) : null
          }
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-5">
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
                        onClick={() => setInput(item)}
                        className="rounded-full bg-[rgb(var(--surface))] px-3 py-1.5 text-[11px] text-muted shadow-[var(--shadow-neu-sm)] transition-colors hover:text-ink"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                }
              />
            ) : (
              <div className="space-y-6">
                {turns.map((turn) => (
                  <article key={turn.id} className={cn(turn.role === 'user' && 'pl-0 md:pl-8')}>
                    {turn.role === 'user' ? (
                      <div className="flex items-start gap-3">
                        <span className="mt-[3px] font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted/55">
                          {new Date(turn.at).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <p className="flex-1 whitespace-pre-wrap rounded-2xl bg-[rgb(var(--sunken))]/45 px-4 py-2.5 text-[12.5px] leading-relaxed text-ink/85">
                          {turn.text}
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="rounded-2xl bg-[rgb(var(--surface))]/70 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] md:px-5">
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
                            <div className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted/55">
                              <Database size={10} />
                              {turn.sources.length} 条来源
                            </div>
                            <SourceList text={turn.text} sources={turn.sources} />
                          </div>
                        ) : null}

                        <div className="mt-3 flex items-center gap-2">
                          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted/50">
                            {turn.mode === 'retrieval'
                              ? 'retrieval only'
                              : turn.mode === 'calc'
                                ? 'calculator'
                                : turn.mode === 'local'
                                  ? 'local runtime'
                                  : 'ai sdk stream'}
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
                              className="ml-auto rounded-lg px-2 py-1 text-[11px] text-muted transition-colors hover:bg-[rgb(var(--surface))] hover:text-ink"
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
                  <div className="flex items-center gap-2 text-[11px] text-muted">
                    <Loader2 size={12} className="animate-spin" />
                    正在生成，可随时停止
                  </div>
                ) : null}

                {error ? (
                  <p className="rounded-lg bg-[#f3e2df] px-3 py-2 text-[11.5px] text-[#8c3b32]">
                    {error.message}
                  </p>
                ) : null}

                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-[rgb(var(--line))]/55 px-4 py-3 md:px-5">
            <div className="flex items-end gap-2">
              <Textarea
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="回车发送，Shift + 回车换行"
                className="min-h-[44px] resize-none text-[12.5px]"
              />
              {busy ? (
                <Button variant="inset" size="sm" onClick={cancel} className="h-11 w-11 shrink-0 p-0">
                  <Square size={14} />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void send()}
                  disabled={!input.trim()}
                  className="h-11 w-11 shrink-0 p-0"
                  aria-label="发送"
                >
                  <ArrowUp size={15} strokeWidth={2} />
                </Button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted/70">
              <span className="font-mono uppercase tracking-[0.14em]">引擎</span>
              <span>{engineLabel}</span>
              <Link href="/studio/settings" className="text-[rgb(var(--copper))]/85 hover:underline">
                去设置
              </Link>
              <span className="text-muted/40">·</span>
              <span>
                检索 {ragOn ? (embedder?.label ?? '哈希') : '已关闭'}
              </span>
            </div>
            {localMode ? (
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted/60">
                端侧 0.5B：改写和短句可用；纯算式会交给本地计算器，其余事实与多步推理建议换云端。
              </p>
            ) : null}
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel title="知识库" hint="入库后立刻参与检索，不上传服务器">
            <div className="space-y-3">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="资料标题，例如：品牌手册"
                className="h-9 text-[12px]"
              />
              <Textarea
                rows={5}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="粘贴需要记住的内容。会自动分段并编号，长文也可以。"
                className="text-[12px]"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-muted/60">
                  {note.trim() ? `${note.trim().length} 字` : '空闲'}
                </span>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={() => void importDoc()}
                  disabled={importing}
                >
                  {importing ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <BookPlus size={13} />
                  )}
                  入库
                </Button>
              </div>
            </div>

            <div className="mt-5 space-y-2.5">
              <Switch
                checked={ragOn}
                onChange={setRagOn}
                label="回答前先检索"
                description="关闭后只带对话上下文，不查知识库。"
              />

              {docs.length === 0 ? (
                <p className="text-[11px] leading-relaxed text-muted/70">
                  还没有资料。导入后，提问时会先命中这里的内容。
                </p>
              ) : (
                <ul className="space-y-2">
                  {docs.map((doc) => (
                    <li
                      key={doc.docId}
                      className="flex items-start gap-2 rounded-xl px-3 py-2 shadow-[var(--shadow-inset-sm)]"
                    >
                      <FileText size={13} className="mt-0.5 shrink-0 text-muted/70" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11.5px] text-ink/85">{doc.title}</div>
                        <div className="font-mono text-[9.5px] text-muted/60">
                          {doc.chunks} 段 · {doc.chars} 字
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void dropDoc(doc.docId)}
                        aria-label={`移除 ${doc.title}`}
                        className="grid h-6 w-6 place-items-center rounded-lg text-muted/60 transition-colors hover:bg-[rgb(var(--sunken))] hover:text-ink"
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <Panel title="检索链路" hint="当前实际使用的嵌入方式">
            <ol className="space-y-2.5 text-[11.5px] leading-relaxed text-muted">
              <li className="flex gap-2">
                <span className="font-mono text-[10px] text-[rgb(var(--copper))]/80">01</span>
                <span>提问先嵌入，与本地片段计算余弦相似度。</span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-[10px] text-[rgb(var(--copper))]/80">02</span>
                <span>取前 4 条，拼成带编号的上下文。</span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-[10px] text-[rgb(var(--copper))]/80">03</span>
                <span>回答里的 [n] 与来源列表一一对应。</span>
              </li>
            </ol>
            <div className="mt-4 flex items-center gap-2 text-[11px] text-muted">
              <Sparkle size={12} className="text-[rgb(var(--copper))]/70" />
              {embedder?.label ?? '读取中'}
              {embedder?.dims ? (
                <span className="font-mono text-[10px] text-muted/60">{embedder.dims} 维</span>
              ) : null}
            </div>
            <Link
              href="/studio/settings"
              className="mt-3 inline-flex items-center gap-1 text-[11px] text-[rgb(var(--copper))]/85 hover:underline"
            >
              更换嵌入模型
            </Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}
