'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { Message } from 'ai';
import { ChannelBadge, Panel, WorkbenchHeader } from '@/components/studio/workbench';
import { textOf } from '@/components/studio/chat-parts';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { channelReady, useEndpoints } from '@/lib/endpoint-store';
import { findModel, useEngines, useModelRuntime } from '@/lib/engines';
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
import { composeRagContext, systemPrompt as buildSystem } from '@/lib/rag';
import {
  deleteChat,
  listChats,
  loadChat,
  newChatId,
  saveChat,
  type ChatSession,
  type ChatSummary,
  type ChatTurn,
} from '@/lib/chats';
import { KnowledgePanel } from './knowledge-panel';
import { Transcript } from './transcript';
import { calcTurns, exchange, localHistory } from './turns';
import { Composer } from './composer';
import { RetrievalPanel } from './retrieval-panel';
import {
  ChatSessionPanel,
  SUGGESTIONS,
  SourceList,
  cloudTurns,
  retrievalAnswer,
  sourcesOf,
  timeAgo,
  type Turn,
} from './parts';

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
  const [sessions, setSessions] = useState<ChatSummary[]>([]);
  // A fresh id from the first paint: a message sent before the history loads
  // still has somewhere to go, instead of being written under an empty id.
  const [activeId, setActiveId] = useState(() => newChatId());
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  // A title typed by the person survives later saves; an empty one means
  // "derive from the first question".
  const customTitle = useRef('');
  const turnsRef = useRef<Turn[]>([]);
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
  }, [loadEngines]);

  // The embedder label used to be read once on mount, so a model that finished
  // loading a moment later left the rail claiming "哈希" while retrieval was
  // already running on-device vectors.
  const residents = useModelRuntime((state) => state.residents);
  useEffect(() => {
    void activeEmbedder().then(setEmbedder);
  }, [residents, prefs.embeddingMode, prefs.embeddingModelId]);

  const refreshDocs = () => {
    if (!user) return;
    listDocuments(user.id)
      .then(setDocs)
      .catch(() => setDocs([]));
  };

  useEffect(refreshDocs, [user]);

  const applySession = useCallback(
    (session: ChatSession) => {
      abortRef.current?.abort();
      stop();
      setLocalBusy(false);
      setActiveId(session.id);
      customTitle.current = session.title;
      setEditingTitle(false);
      remembered.current.clear();
      setCloudSources(sourcesOf(session.turns));

      // Cloud transcripts have to go back through useChat: it is what holds
      // the history the next request sends. Local ones live in this component.
      if (session.turns.some((turn) => turn.mode === 'cloud')) {
        setLocalTurns([]);
        setMessages(
          session.turns.map((turn) => ({
            id: turn.id,
            role: turn.role,
            content: turn.text,
            createdAt: new Date(turn.at),
          })),
        );
      } else {
        setMessages([]);
        setLocalTurns(session.turns);
      }
    },
    [setMessages, stop],
  );

  const persist = useCallback(
    async (rows: Turn[]) => {
      if (rows.length === 0) return;
      const stored: ChatTurn[] = rows.map((turn) => ({
        id: turn.id,
        role: turn.role,
        text: turn.text,
        at: turn.at,
        mode: turn.mode,
        sources: turn.sources,
      }));
      try {
        const saved = await saveChat({
          id: activeId,
          owner,
          title: customTitle.current,
          turns: stored,
        });
        if (saved) customTitle.current = saved.title;
        setSessions(await listChats(owner));
      } catch {
        // A blocked or full store must not break the transcript in front of
        // the person: the tab still holds it, it just will not survive reload.
      }
    },
    [activeId, owner],
  );

  async function startNew() {
    // Await the save: `persist` writes the derived title back into
    // `customTitle`, and letting that land after the reset below would give the
    // new session the old one's name.
    await persist(turnsRef.current);
    abortRef.current?.abort();
    stop();
    setLocalBusy(false);
    setMessages([]);
    setLocalTurns([]);
    setCloudSources(new Map());
    remembered.current.clear();
    customTitle.current = '';
    setEditingTitle(false);
    setActiveId(newChatId());
  }

  async function openChat(id: string) {
    if (id === activeId) return;
    await persist(turnsRef.current);
    const session = await loadChat(id);
    if (session) applySession(session);
  }

  async function dropChat(id: string) {
    await deleteChat(id);
    const rows = await listChats(owner);
    setSessions(rows);
    toast('已删除会话', 'success');
    if (id !== activeId) return;

    // Move to the next session before clearing, so the save effect cannot
    // write the old turns back under the id that was just deleted.
    const next = rows.length > 0 ? await loadChat(rows[0].id) : null;
    if (next) {
      applySession(next);
    } else {
      setActiveId(newChatId());
      setMessages([]);
      setLocalTurns([]);
      setCloudSources(new Map());
      remembered.current.clear();
      customTitle.current = '';
    }
  }

  const commitRename = () => {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next) return;
    customTitle.current = next;
    void persist(turnsRef.current);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await listChats(owner);
      if (cancelled) return;
      setSessions(rows);
      if (rows.length === 0) return;
      const session = await loadChat(rows[0].id);
      if (!cancelled && session) applySession(session);
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, applySession]);

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

    // Deterministic input should not be sampled: on-device models read "10-3"
    // as 10.3 often enough that arithmetic is answered here, while everything
    // else still goes to the model.
    if (localMode) {
      const calc = calcTurns(text);
      if (calc) {
        setLocalTurns((rows) => [...rows, ...calc]);
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
      const pair = exchange(id, text, '', 'local', hits);
      const answerId = pair[1].id;
      setLocalTurns((rows) => [...rows, ...pair]);
      setLocalBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const system = buildSystem(context, true);
      const history = localHistory(localTurns);

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
      const answer = exchange(id, text, retrievalAnswer(hits), 'retrieval', hits);
      setLocalTurns((rows) => [...rows, ...answer]);
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
    customTitle.current = '';
    const stale = activeId;
    setActiveId(newChatId());
    // 清空 means start over, so the stored copy goes too; otherwise the list
    // keeps a session whose transcript no longer exists on screen.
    if (stale) {
      void deleteChat(stale)
        .then(() => listChats(owner))
        .then(setSessions)
        .catch(() => undefined);
    }
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

  const cloudView = cloudTurns(messages, cloudSources);
  // Whichever side has a transcript wins. Preferring one by engine mode hid a
  // restored cloud session as soon as the engine was switched to local.
  const turns: Turn[] = localTurns.length > 0 ? localTurns : cloudView;

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  // Save as soon as a turn settles. Writing per token would hammer IndexedDB
  // and store the same final text anyway, and the effect only re-runs on a new
  // turn, so nothing is throttled here. An aborted answer still keeps its
  // question, because the user turn lands before the stream starts.
  useEffect(() => {
    if (localBusy || status === 'streaming') return;
    if (!activeId || turns.length === 0) return;
    void persist(turnsRef.current);
  }, [activeId, localBusy, status, turns.length, persist]);

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
          <Transcript
            turns={turns}
            busy={busy}
            error={error}
            bottomRef={bottomRef}
            onSuggestion={setInput}
          />

          <Composer
            value={input}
            onChange={setInput}
            onSend={() => void send()}
            onStop={cancel}
            busy={busy}
            engineLabel={engineLabel}
            ragLabel={ragOn ? (embedder?.label ?? '哈希') : '已关闭'}
            localMode={localMode}
          />
        </Panel>

        <div className="space-y-5">
          <ChatSessionPanel
            sessions={sessions}
            activeId={activeId}
            editing={editingTitle}
            draft={titleDraft}
            onDraftChange={setTitleDraft}
            onOpen={openChat}
            onNew={startNew}
            onCommit={commitRename}
            onCancel={() => setEditingTitle(false)}
            onBeginRename={(row) => {
              setTitleDraft(customTitle.current || row.title);
              setEditingTitle(true);
            }}
            onDelete={dropChat}
          />

          <KnowledgePanel
            title={title}
            onTitle={setTitle}
            note={note}
            onNote={setNote}
            importing={importing}
            onImport={() => void importDoc()}
            rag={ragOn}
            onRag={setRagOn}
            docs={docs}
            onDrop={(docId) => void dropDoc(docId)}
          />

          <RetrievalPanel embedder={embedder} />


        </div>
      </div>
    </div>
  );
}
