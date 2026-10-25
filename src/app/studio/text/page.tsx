'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { Message } from 'ai';
import { Check, Copy, Loader2, RotateCcw, Save, Square, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { Segmented, Slider, Switch } from '@/components/ui/controls';
import { ChannelBadge, EmptyState, Panel, WorkbenchHeader } from '@/components/studio/workbench';
import { RichText } from '@/components/studio/rich-text';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { channelReady, useEndpoints } from '@/lib/endpoint-store';
import { useEngines, findModel } from '@/lib/engines';
import { streamLocal } from '@/lib/local-runtime';
import { offlineDraft, draftToText, type Tone } from '@/lib/demo';
import { readMemoryPrefs, remember, retrieve, setMemoryPrefs, toRagSources } from '@/lib/memory';
import { composeRagContext } from '@/lib/rag';
import { listProjects, relativeTime, saveProject, type Project } from '@/lib/projects';
import { cn } from '@/lib/cn';

const TONES: Tone[] = ['克制', '明亮', '锋利'];

const SEEDS = [
  '写一段 30 秒短片旁白，关于城市凌晨的便利店',
  '为一个手工皂品牌写三版短文案，克制、不喊口号',
  '把一次雨天的通勤写成分镜脚本，不要旁白',
];

const SYSTEM_PROMPT =
  '你是一位中文写作编辑。直接给出可用的文本，不写开场白，不解释创作过程，不复述要求。' +
  '按用户给出的题材与语气写作，段落之间留空行；需要结构时用二级标题，不要使用多余修辞。' +
  '当需要确认语气规则、篇幅或标题备选时，可以调用提供的工具。';

type LocalTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  mode?: 'local' | 'offline';
};

function textOf(message: Message): string {
  const fromParts = (message.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text: string }).text)
    .join('');
  return fromParts || message.content || '';
}

function Tools({ message }: { message: Message }) {
  const calls = (message.parts ?? []).filter((part) => part.type === 'tool-invocation');
  if (!calls.length) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {calls.map((part) => {
        const invocation = (
          part as { toolInvocation: { toolCallId: string; toolName: string; state: string } }
        ).toolInvocation;
        return (
          <span
            key={invocation.toolCallId}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9.5px] tracking-wide text-muted shadow-[var(--shadow-inset-sm)]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--copper))]/70" />
            {invocation.toolName}
            <span className="text-muted/60">
              {invocation.state === 'result' ? 'done' : 'running'}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default function TextWorkbench() {
  const { user } = useAuth();
  const endpoints = useEndpoints((state) => state.endpoints);
  const health = useEndpoints((state) => state.health);
  const live = channelReady({ endpoints, health }, 'text');

  // The engine is chosen in settings; this workbench only reads the result.
  const prefs = useEngines((state) => state.prefs);
  const loadEngines = useEngines((state) => state.load);

  const [brief, setBrief] = useState('');
  const [tone, setTone] = useState<Tone>('克制');
  const [length, setLength] = useState(60);
  const [memoryOn, setMemoryOn] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [saved, setSaved] = useState<Project[]>([]);
  const [localTurns, setLocalTurns] = useState<LocalTurn[]>([]);
  const [localBusy, setLocalBusy] = useState(false);
  const [hits, setHits] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const owner = user?.id ?? 'local';
  const localMode = prefs.textMode === 'local';
  const localModel = findModel(prefs.textModelId);
  const system = useMemo(() => SYSTEM_PROMPT, []);

  const { messages, append, reload, stop, status, setMessages, error } = useChat({
    api: '/api/chat',
    maxSteps: 3,
    experimental_prepareRequestBody: ({ messages: current }) => ({
      messages: current,
      system,
      temperature: tone === '锋利' ? 0.9 : tone === '明亮' ? 0.8 : 0.6,
      maxTokens: Math.round(360 + length * 16),
      baseUrl: endpoints.text.baseUrl,
      apiKey: endpoints.text.apiKey,
      model: endpoints.text.model,
      wire: endpoints.text.shape,
    }),
    onError: (err) => toast(err.message, 'error'),
  });

  useEffect(() => {
    void loadEngines();
    void readMemoryPrefs().then((value) => setMemoryOn(value.enabled));
  }, [loadEngines]);

  useEffect(() => {
    if (!user) return;
    listProjects(user.id, 'text')
      .then((rows) => setSaved(rows.slice(0, 4)))
      .catch(() => setSaved([]));
  }, [user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, localTurns.length]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = localMode ? localBusy : status === 'submitted' || status === 'streaming';

  const generate = async () => {
    const text = brief.trim();
    if (!text) {
      toast('先写一句提纲', 'error');
      return;
    }
    if (busy) return;

    const recalled = memoryOn
      ? await retrieve(text, owner, { topK: 4, kinds: ['text', 'doc', 'story'] })
      : [];
    setHits(recalled.length);
    const context = composeRagContext(toRagSources(recalled));
    const prompt = `${text}\n\n语气：${tone}。篇幅约 ${length * 6} 字。`;

    if (localMode) {
      const model = localModel;
      if (!model) {
        toast('先在设置里下载一个本地模型', 'error');
        return;
      }
      const id = `local_${Date.now()}`;
      const answerId = `${id}_a`;
      setLocalTurns((rows) => [
        ...rows,
        { id, role: 'user', text, at: Date.now() },
        { id: answerId, role: 'assistant', text: '', at: Date.now(), mode: 'local' },
      ]);
      setLocalBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;

      let produced = '';
      try {
        await streamLocal({
          model,
          source: prefs.source,
          backendPreference: prefs.backend,
          system: context ? `${system}\n\n${context}` : system,
          turns: [{ role: 'user', content: prompt }],
          // On-device decoding runs at a few tokens per second; 700 tokens
          // would take minutes, so the local path keeps the budget short.
          maxTokens: Math.min(240, Math.round(80 + length * 3)),
          temperature: tone === '锋利' ? 0.9 : tone === '明亮' ? 0.8 : 0.6,
          signal: controller.signal,
          onToken: (chunk) => {
            produced += chunk;
            setLocalTurns((rows) =>
              rows.map((row) => (row.id === answerId ? { ...row, text: produced } : row)),
            );
          },
        });
        if (produced.trim()) {
          void remember({
            owner,
            kind: 'text',
            text: `${text}（${tone}）`,
            tags: ['text', tone, 'local'],
          });
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : '本地生成失败', 'error');
      } finally {
        setLocalBusy(false);
      }
      return;
    }

    if (!live) {
      const draft = offlineDraft(text, tone);
      const id = `off_${Date.now()}`;
      setLocalTurns((rows) => [
        ...rows,
        { id, role: 'user', text, at: Date.now() },
        { id: `${id}_a`, role: 'assistant', text: draftToText(draft), at: Date.now(), mode: 'offline' },
      ]);
      void remember({ owner, kind: 'text', text: `${text}（${tone}）`, tags: ['text', tone, 'offline'] });
      return;
    }

    await append({ role: 'user', content: prompt });
    void remember({ owner, kind: 'text', text: `${text}（${tone}）`, tags: ['text', tone] });
  };

  const cancel = () => {
    abortRef.current?.abort();
    stop();
    setLocalBusy(false);
  };

  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const latestText = latestAssistant ? textOf(latestAssistant) : '';

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      toast('无法访问剪贴板', 'error');
    }
  };

  const keep = async (id: string, prompt: string, text: string) => {
    if (!user || !text.trim()) return;
    try {
      const record = await saveProject({
        owner: user.id,
        kind: 'text',
        title: prompt,
        summary: text.replace(/\n+/g, ' ').slice(0, 120),
        payload: { brief: prompt, text, tone, mode: localMode ? 'local' : 'api' },
      });
      setSaved((rows) => [record, ...rows].slice(0, 4));
      toast('已存入作品库', 'success');
    } catch {
      toast('保存失败，存储空间可能已满', 'error');
    }
  };

  const turns: Array<{
    id: string;
    role: 'user' | 'assistant';
    text: string;
    at: number;
    tools?: Message;
    mode?: 'local' | 'offline';
  }> =
    localMode || localTurns.length
      ? localTurns
      : messages.map((message) => ({
          id: message.id,
          role: message.role === 'assistant' ? 'assistant' : 'user',
          text: textOf(message),
          at: (message.createdAt ?? new Date()).getTime(),
          tools: message.role === 'assistant' ? message : undefined,
        }));

  return (
    <div>
      <WorkbenchHeader
        index="01"
        title="文本创作台"
        description="给出提纲与语气，逐句生成。云端走 AI SDK 流式与工具调用，本地模型在浏览器内推理，两者都可中断。"
        actions={<ChannelBadge channel="text" />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="提纲" hint="一句话说明写什么、给谁看">
            <Textarea
              rows={4}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="例如：为一家只在夜里营业的书店写一段开业预告，语气克制。"
              className="text-[13px]"
            />

            <div className="mt-3 flex flex-wrap gap-1.5">
              {SEEDS.map((seed) => (
                <button
                  key={seed}
                  type="button"
                  onClick={() => setBrief(seed)}
                  className="rounded-full bg-[rgb(var(--surface))] px-2.5 py-1 text-[10.5px] text-muted shadow-[var(--shadow-neu-sm)] transition-colors hover:text-ink"
                >
                  {seed.slice(0, 9)}…
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-3.5">
              <div className="rounded-xl px-3 py-2.5 shadow-[var(--shadow-inset-sm)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted">引擎</span>
                  <Link
                    href="/studio/settings"
                    className="text-[10.5px] text-[rgb(var(--copper))]/85 hover:underline"
                  >
                    在设置中更换
                  </Link>
                </div>
                <div className="mt-1 text-[12px] text-ink/85">
                  {localMode
                    ? `本地 · ${localModel?.label ?? '未选择模型'}`
                    : live
                      ? `云端 · ${endpoints.text.model}`
                      : '云端 · 未配置'}
                </div>
              </div>

              <div>
                <div className="mb-2 text-[12px] font-medium tracking-wide text-muted">语气</div>
                <Segmented
                  size="sm"
                  value={tone}
                  onChange={(next) => setTone(next)}
                  options={TONES.map((item) => ({ value: item, label: item }))}
                />
              </div>

              <Slider
                label="篇幅"
                min={20}
                max={100}
                value={length}
                display={`约 ${length * 6} 字`}
                onChange={setLength}
              />

              <Switch
                checked={memoryOn}
                onChange={(next) => {
                  setMemoryOn(next);
                  void setMemoryPrefs({ enabled: next });
                }}
                label="召回本地记忆"
                description="把过往的语气与偏好带入本次上下文。"
              />
            </div>

            <div className="mt-5 flex gap-2">
              {busy ? (
                <Button variant="inset" size="md" className="flex-1" onClick={cancel}>
                  <Square size={13} />
                  停止
                </Button>
              ) : (
                <Button variant="primary" size="md" className="flex-1" onClick={generate}>
                  <Wand2 size={14} strokeWidth={1.8} />
                  开始起草
                </Button>
              )}
            </div>

            <p className="mt-3 text-[10.5px] leading-relaxed text-muted/70">
              {localMode
                ? `在浏览器内运行 ${localModel?.label ?? '本地模型'}，权重已缓存，首次推理需要加载 10–20 秒。`
                : live
                  ? `经由 ${endpoints.text.model} 生成。工具：style_guide / measure / title_variants。`
                  : '未配置文本端点：本次输出为离线结构草案，不是模型生成结果。'}
            </p>
            {hits > 0 ? (
              <p className="mt-1 font-mono text-[10px] text-[rgb(var(--copper))]/80">
                已召回 {hits} 条记忆
              </p>
            ) : null}
          </Panel>

          <Panel title="作品库" hint="最近保存的文本">
            {saved.length === 0 ? (
              <p className="text-[11.5px] leading-relaxed text-muted/75">还没有保存的文本。</p>
            ) : (
              <ul className="space-y-2.5">
                {saved.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const body = (item.payload as { text?: string }).text ?? '';
                        setBrief(item.title);
                        setLocalTurns([
                          { id: 'loaded_u', role: 'user', text: item.title, at: item.updatedAt },
                          { id: 'loaded_a', role: 'assistant', text: body, at: item.updatedAt },
                        ]);
                      }}
                      className="group w-full text-left"
                    >
                      <div className="truncate text-[12px] text-ink/85 group-hover:text-ink">
                        {item.title}
                      </div>
                      <div className="mt-0.5 font-mono text-[9.5px] text-muted/60">
                        {relativeTime(item.updatedAt)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel
          className="flex min-h-[560px] flex-col"
          bodyClassName="flex min-h-0 flex-1 flex-col p-0"
          title="输出"
          hint={turns.length ? `${turns.length} 段` : '尚未开始'}
          action={
            turns.length ? (
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  setLocalTurns([]);
                }}
                className="text-[11px] text-muted transition-colors hover:text-ink"
              >
                清空
              </button>
            ) : null
          }
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {turns.length === 0 ? (
              <EmptyState
                title="还没有草稿"
                description="左侧写一句提纲，选一个语气。生成过程中可以随时停下，已经出现的文字会保留。"
              />
            ) : (
              <div className="space-y-7">
                {turns.map((turn) => (
                  <article key={turn.id}>
                    {turn.role === 'user' ? (
                      <div className="flex items-start gap-3">
                        <span className="mt-[3px] font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted/55">
                          {new Date(turn.at).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <p className="flex-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
                          {turn.text}
                        </p>
                      </div>
                    ) : null}

                    {turn.role === 'assistant' ? (
                      <>
                        <div className="mt-4 rounded-2xl bg-[rgb(var(--surface))]/70 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
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

                        {turn.tools ? <Tools message={turn.tools} /> : null}

                        <div className="mt-3 flex items-center gap-1">
                          <span className="mr-auto font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted/50">
                            {turn.mode === 'offline'
                              ? 'offline draft'
                              : turn.mode === 'local'
                                ? 'local runtime'
                                : 'ai sdk stream'}
                          </span>

                          <button
                            type="button"
                            onClick={() => copy(turn.id, turn.text)}
                            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-muted transition-colors hover:bg-[rgb(var(--surface))] hover:text-ink"
                          >
                            {copied === turn.id ? <Check size={12} /> : <Copy size={12} />}
                            {copied === turn.id ? '已复制' : '复制'}
                          </button>

                          {turn.text ? (
                            <button
                              type="button"
                              onClick={() => keep(turn.id, brief, turn.text)}
                              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-muted transition-colors hover:bg-[rgb(var(--surface))] hover:text-ink"
                            >
                              <Save size={12} />
                              保存
                            </button>
                          ) : null}

                          {!busy && latestText ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (localMode) void generate();
                                else void reload();
                              }}
                              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-muted transition-colors hover:bg-[rgb(var(--surface))] hover:text-ink"
                            >
                              <RotateCcw size={12} />
                              重写
                            </button>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </article>
                ))}

                {busy ? (
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
        </Panel>
      </div>
    </div>
  );
}
