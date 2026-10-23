'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, RotateCcw, Save, Square, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { Segmented, Slider, Switch } from '@/components/ui/controls';
import { ChannelBadge, EmptyState, Panel, WorkbenchHeader } from '@/components/studio/workbench';
import { RichText } from '@/components/studio/rich-text';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { channelReady, useEndpoints } from '@/lib/endpoint-store';
import { streamChat } from '@/lib/api';
import { draftToText, offlineDraft, type Tone } from '@/lib/demo';
import { memoryContext, readMemoryPrefs, recall, remember, setMemoryPrefs } from '@/lib/memory';
import { listProjects, relativeTime, saveProject, type Project } from '@/lib/projects';

type Turn = {
  id: string;
  brief: string;
  text: string;
  mode: 'live' | 'offline';
  hits: number;
  at: number;
};

const TONES: Tone[] = ['克制', '明亮', '锋利'];

const SEEDS = [
  '写一段 30 秒短片旁白，关于城市凌晨的便利店',
  '为一个手工皂品牌写三版短文案，克制、不喊口号',
  '把一次雨天的通勤写成分镜脚本，不要旁白',
];

const SYSTEM_PROMPT =
  '你是一位中文写作编辑。直接给出可用的文本，不写开场白，不解释创作过程，不复述要求。' +
  '按用户给出的题材与语气写作，段落之间留空行；需要结构时用二级标题，不要使用多余修辞。';

export default function TextWorkbench() {
  const { user } = useAuth();
  const endpoints = useEndpoints((state) => state.endpoints);
  const health = useEndpoints((state) => state.health);
  const live = channelReady({ endpoints, health }, 'text');

  const [brief, setBrief] = useState('');
  const [tone, setTone] = useState<Tone>('克制');
  const [length, setLength] = useState(60);
  const [memoryOn, setMemoryOn] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [saved, setSaved] = useState<Project[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const owner = user?.id ?? 'local';

  useEffect(() => {
    readMemoryPrefs().then((prefs) => setMemoryOn(prefs.enabled));
  }, []);

  useEffect(() => {
    if (!user) return;
    listProjects(user.id, 'text')
      .then((rows) => setSaved(rows.slice(0, 4)))
      .catch(() => setSaved([]));
  }, [user]);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const patchTurn = (id: string, text: string) => {
    setTurns((rows) => rows.map((row) => (row.id === id ? { ...row, text } : row)));
  };

  const stop = () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setBusy(false);
  };

  const typeOut = (id: string, full: string) =>
    new Promise<void>((resolve) => {
      let cursor = 0;
      const step = () => {
        if (cancelledRef.current) {
          resolve();
          return;
        }
        cursor = Math.min(full.length, cursor + 3 + Math.floor(Math.random() * 5));
        patchTurn(id, full.slice(0, cursor));
        if (cursor < full.length) {
          timerRef.current = window.setTimeout(step, 14);
        } else {
          resolve();
        }
      };
      step();
    });

  const generate = async (override?: string) => {
    const text = (override ?? brief).trim();
    if (!text) {
      toast('先写一句提纲', 'error');
      return;
    }
    if (busy) return;

    setBusy(true);
    cancelledRef.current = false;

    const id = `turn_${Date.now()}`;
    const hits = memoryOn ? await recall(text, owner, 4) : [];
    const turn: Turn = {
      id,
      brief: text,
      text: '',
      mode: live ? 'live' : 'offline',
      hits: hits.length,
      at: Date.now(),
    };
    setTurns((rows) => [...rows, turn]);

    if (live) {
      const controller = new AbortController();
      abortRef.current = controller;
      const context = memoryContext(hits);
      const history = turns.slice(-2).flatMap((row) => [
        { role: 'user' as const, content: row.brief },
        { role: 'assistant' as const, content: row.text },
      ]);

      let produced = '';
      try {
        await streamChat({
          endpoint: endpoints.text,
          messages: [
            { role: 'system', content: context ? `${SYSTEM_PROMPT}\n\n${context}` : SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: `${text}\n\n语气：${tone}。篇幅约 ${length * 6} 字。` },
          ],
          temperature: tone === '锋利' ? 0.9 : tone === '明亮' ? 0.8 : 0.6,
          maxTokens: Math.round(360 + length * 16),
          signal: controller.signal,
          onDelta: (delta) => {
            produced += delta;
            patchTurn(id, produced);
          },
        });
      } catch (error) {
        if (!cancelledRef.current) {
          const message = error instanceof Error ? error.message : '生成失败';
          toast(message, 'error');
          setTurns((rows) => rows.filter((row) => row.id !== id));
        }
        setBusy(false);
        return;
      }

      if (produced.trim()) {
        void remember({ owner, kind: 'text', text: `${text}（${tone}）`, tags: ['text', tone] });
      }
      setBusy(false);
      return;
    }

    const draft = offlineDraft(text, tone);
    await typeOut(id, draftToText(draft));
    if (!cancelledRef.current) {
      void remember({ owner, kind: 'text', text: `${text}（${tone}）`, tags: ['text', tone, 'offline'] });
    }
    setBusy(false);
  };

  const copy = async (turn: Turn) => {
    try {
      await navigator.clipboard.writeText(turn.text);
      setCopied(turn.id);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      toast('无法访问剪贴板', 'error');
    }
  };

  const keep = async (turn: Turn) => {
    if (!user) return;
    try {
      const record = await saveProject({
        owner: user.id,
        kind: 'text',
        title: turn.brief,
        summary: turn.text.replace(/\n+/g, ' ').slice(0, 120),
        payload: { brief: turn.brief, text: turn.text, tone, mode: turn.mode },
      });
      setSaved((rows) => [record, ...rows].slice(0, 4));
      toast('已存入作品库', 'success');
    } catch {
      toast('保存失败，存储空间可能已满', 'error');
    }
  };

  return (
    <div>
      <WorkbenchHeader
        index="01"
        title="文本创作台"
        description="给出提纲与语气，逐句生成。连接服务时走流式输出，未连接时给出结构草案，生成过程都可中断。"
        actions={<ChannelBadge channel="text" />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,336px)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="提纲" hint="一句话说明写什么、给谁看">
            <Textarea
              rows={6}
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
                  {seed.slice(0, 14)}…
                </button>
              ))}
            </div>

            <div className="mt-5 space-y-5">
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

            <div className="mt-6 flex gap-2">
              {busy ? (
                <Button variant="inset" size="md" className="flex-1" onClick={stop}>
                  <Square size={13} />
                  停止
                </Button>
              ) : (
                <Button variant="primary" size="md" className="flex-1" onClick={() => generate()}>
                  <Wand2 size={14} strokeWidth={1.8} />
                  开始起草
                </Button>
              )}
            </div>

            <p className="mt-3 text-[10.5px] leading-relaxed text-muted/70">
              {live
                ? `经由 ${endpoints.text.model} 生成，密钥仅存在于本机。`
                : '未配置文本端点：本次输出为离线结构草案，不是模型生成结果。'}
            </p>
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
                        setTurns([
                          {
                            id: `turn_${Date.now()}`,
                            brief: item.title,
                            text: body,
                            mode: 'live',
                            hits: 0,
                            at: item.updatedAt,
                          },
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
          hint={turns.length ? `${turns.length} 段草稿` : '尚未开始'}
          action={
            turns.length ? (
              <button
                type="button"
                onClick={() => setTurns([])}
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
                    <div className="flex items-start gap-3">
                      <span className="mt-[3px] font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted/55">
                        {new Date(turn.at).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <p className="flex-1 text-[12.5px] leading-relaxed text-muted">{turn.brief}</p>
                    </div>

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

                      {busy && turn.id === turns[turns.length - 1]?.id ? (
                        <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-[rgb(var(--accent))]/70 align-middle" />
                      ) : null}
                    </div>

                    <div className="mt-3 flex items-center gap-1">
                      <span className="mr-auto flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted/50">
                        {turn.mode === 'live' ? 'stream' : 'offline draft'}
                        {turn.hits > 0 ? ` · 记忆 ${turn.hits}` : ''}
                      </span>

                      <button
                        type="button"
                        onClick={() => copy(turn)}
                        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-muted transition-colors hover:bg-[rgb(var(--surface))] hover:text-ink"
                      >
                        {copied === turn.id ? <Check size={12} /> : <Copy size={12} />}
                        {copied === turn.id ? '已复制' : '复制'}
                      </button>

                      {turn.text ? (
                        <button
                          type="button"
                          onClick={() => keep(turn)}
                          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-muted transition-colors hover:bg-[rgb(var(--surface))] hover:text-ink"
                        >
                          <Save size={12} />
                          保存
                        </button>
                      ) : null}

                      {!busy && turn.text ? (
                        <button
                          type="button"
                          onClick={() => {
                            setBrief(turn.brief);
                            void generate(turn.brief);
                          }}
                          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-muted transition-colors hover:bg-[rgb(var(--surface))] hover:text-ink"
                        >
                          <RotateCcw size={12} />
                          重写
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}

                {busy ? (
                  <div className="flex items-center gap-2 text-[11px] text-muted">
                    <Loader2 size={12} className="animate-spin" />
                    正在生成，可随时停止
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
