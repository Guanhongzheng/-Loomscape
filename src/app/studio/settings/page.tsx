'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Segmented, Switch } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { Panel, WorkbenchHeader } from '@/components/studio/workbench';
import { EnginePanel } from '@/components/studio/engine-panel';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { channelReady, useEndpoints } from '@/lib/endpoint-store';
import { PRESETS, hasKey, presetFor, type Channel, type Endpoint } from '@/lib/providers';
import { probeEndpoint } from '@/lib/api';
import {
  forget,
  forgetAll,
  listMemories,
  readMemoryPrefs,
  setMemoryPrefs,
  type MemoryDepth,
  type MemoryRecord,
} from '@/lib/memory';
import { STORES, all, clear } from '@/lib/db';
import { formatBytes } from '@/lib/engines';
import { relativeTime } from '@/lib/projects';
import { cn } from '@/lib/cn';

const CHANNELS: Array<{ id: Channel; title: string; note: string }> = [
  { id: 'embedding', title: '嵌入', note: 'OpenAI 兼容的 /embeddings' },
  { id: 'image', title: '图像', note: 'OpenAI Images 或 Stability' },
  { id: 'speech', title: '语音', note: 'Whisper 兼容的 /audio/transcriptions' },
];

const KIND_LABEL: Record<string, string> = {
  text: '文本',
  image: '图像',
  voice: '声音',
  video: '影像',
  story: '故事',
  note: '备注',
  doc: '资料',
};

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const endpoints = useEndpoints((state) => state.endpoints);
  const health = useEndpoints((state) => state.health);
  const store = useEndpoints((state) => state.store);

  const [drafts, setDrafts] = useState(endpoints);
  const [testing, setTesting] = useState<Channel | null>(null);

  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [depth, setDepth] = useState<MemoryDepth>('mid');
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  // Collapsed by default: three four-field forms on one screen was the main
  // reason this page read as a wall of inputs.
  const [openChannel, setOpenChannel] = useState<Channel | null>(null);

  useEffect(() => {
    setDrafts(endpoints);
  }, [endpoints]);

  useEffect(() => {
    readMemoryPrefs().then((prefs) => {
      setMemoryEnabled(prefs.enabled);
      setDepth(prefs.depth);
    });
  }, []);

  const reloadMemories = () => {
    if (!user) return;
    listMemories(user.id).then((rows) => setMemories(rows));
  };

  useEffect(reloadMemories, [user]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
    navigator.storage.estimate().then((estimate) => {
      setUsage({ used: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
    });
  }, [memories.length]);

  const update = (channel: Channel, patch: Partial<Endpoint>) => {
    setDrafts((rows) => ({ ...rows, [channel]: { ...rows[channel], ...patch } }));
  };

  const applyPreset = (channel: Channel, presetId: string) => {
    const preset = presetFor(channel, presetId);
    if (!preset) return;
    update(channel, {
      preset: preset.id,
      label: preset.label,
      baseUrl: preset.baseUrl,
      shape: preset.shape,
      model: preset.models[0] ?? drafts[channel].model,
    });
  };

  const save = async (channel: Channel) => {
    try {
      await store(drafts[channel]);
      toast(`${CHANNELS.find((item) => item.id === channel)?.title}端点已保存`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存失败', 'error');
    }
  };

  const test = async (channel: Channel) => {
    const endpoint = drafts[channel];
    if (!hasKey(endpoint)) {
      toast('先填写服务地址与密钥', 'error');
      return;
    }
    if (channel !== 'text') {
      toast('嵌入、图像与语音端点请在对应工作台实测', 'info');
      return;
    }
    setTesting(channel);
    try {
      const seen = await probeEndpoint(endpoint);
      if (seen) toast(`连接正常 · ${seen.slice(0, 12)}`, 'success');
      else toast('已连通，但没有返回内容', 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : '连接失败', 'error');
    } finally {
      setTesting(null);
    }
  };

  const exportAll = async () => {
    const bundle: Record<string, unknown> = { exportedAt: new Date().toISOString() };
    for (const name of Object.values(STORES)) {
      bundle[name] = await all(name).catch(() => []);
    }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `loomscape-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast('已导出本地数据', 'success');
  };

  const wipe = async () => {
    for (const name of Object.values(STORES)) {
      await clear(name).catch(() => {});
    }
    setWipeOpen(false);
    logout();
    toast('本地数据已清空', 'success');
    window.location.href = '/';
  };

  return (
    <div>
      <WorkbenchHeader
        index="08"
        title="设置"
        description="端点、密钥、记忆与本地模型都在这一页，只写入本机浏览器。"
      />

      <div className="space-y-5">
        <EnginePanel />

        <Panel title="其它端点" hint="嵌入、图像与语音通道；文本引擎在上方配置">
          <div className="divide-y divide-[rgb(var(--line))]/45">
            {CHANNELS.map((channel) => {
              const draft = drafts[channel.id];
              const preset = PRESETS[channel.id].find((item) => item.id === draft.preset);
              const ready = channelReady({ endpoints, health }, channel.id);
              const clientReady = hasKey(draft);
              const open = openChannel === channel.id;

              return (
                <div key={channel.id}>
                  <button
                    type="button"
                    onClick={() => setOpenChannel(open ? null : channel.id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-3 py-3 text-left"
                  >
                    <span className="w-10 shrink-0 text-[12px] text-ink/85">{channel.title}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted/70">
                      {channel.note}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] text-muted/70">
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          ready ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--copper))]/70',
                        )}
                      />
                      {ready ? '已连接' : '未配置'}
                    </span>
                    <ChevronDown
                      size={14}
                      className={cn('shrink-0 text-muted/50 transition-transform', open && 'rotate-180')}
                    />
                  </button>

                  {open ? (
                    <div className="pb-5 sm:pl-[52px]">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-[10.5px] text-muted">服务商</label>
                          <Select
                            value={draft.preset}
                            onChange={(event) => applyPreset(channel.id, event.target.value)}
                            className="h-9 text-[12px]"
                          >
                            {PRESETS[channel.id].map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.label}
                              </option>
                            ))}
                          </Select>
                        </div>

                        <div>
                          <label className="mb-1.5 block text-[10.5px] text-muted">模型</label>
                          <Input
                            value={draft.model}
                            onChange={(event) => update(channel.id, { model: event.target.value })}
                            placeholder={preset?.models[0] ?? 'model-id'}
                            className="h-9 font-mono text-[11.5px]"
                            list={`models-${channel.id}`}
                            spellCheck={false}
                          />
                          <datalist id={`models-${channel.id}`}>
                            {(preset?.models ?? []).map((model) => (
                              <option key={model} value={model} />
                            ))}
                          </datalist>
                        </div>

                        <div>
                          <label className="mb-1.5 block text-[10.5px] text-muted">Base URL</label>
                          <Input
                            value={draft.baseUrl}
                            onChange={(event) => update(channel.id, { baseUrl: event.target.value })}
                            placeholder="https://api.example.com/v1"
                            className="h-9 font-mono text-[11.5px]"
                            spellCheck={false}
                          />
                        </div>

                        <SecretInput
                          value={draft.apiKey}
                          onChange={(value) => update(channel.id, { apiKey: value })}
                        />
                      </div>

                      <div className="mt-3 flex gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => save(channel.id)}
                          disabled={!clientReady && draft.apiKey.length > 0}
                        >
                          <Check size={12} />
                          保存
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => test(channel.id)}
                          disabled={testing === channel.id || !clientReady}
                        >
                          {testing === channel.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : null}
                          测试
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-[10.5px] leading-relaxed text-muted/60">
            密钥只写进本机 IndexedDB。请求经 /api/chat 转发时只存在于内存，不落盘、不写日志。
            每次转发都会校验目标地址，内网与回环地址会被拒绝。
          </p>
        </Panel>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel title="记忆" hint={`${memories.length} 条`}>
            <Switch
              checked={memoryEnabled}
              onChange={(next) => {
                setMemoryEnabled(next);
                void setMemoryPrefs({ enabled: next });
              }}
              label="记录创作记忆"
              description="把提纲、语气与作品摘要编码成本地向量，用于跨会话召回。"
            />

            <div className="mt-5">
              <div className="mb-2 text-[12px] font-medium tracking-wide text-muted">召回范围</div>
              <Segmented
                size="sm"
                value={depth}
                onChange={(next) => {
                  setDepth(next);
                  void setMemoryPrefs({ depth: next });
                }}
                options={[
                  { value: 'low', label: '近 10 条' },
                  { value: 'mid', label: '近 30 条' },
                  { value: 'high', label: '全部' },
                ]}
              />
            </div>

            <div className="mt-5 max-h-[220px] space-y-2 overflow-y-auto pr-1">
              {memories.length === 0 ? (
                <p className="text-[11.5px] text-muted/70">还没有记忆片段。</p>
              ) : (
                memories.map((memory) => (
                  <div
                    key={memory.id}
                    className="group flex items-start gap-2.5 rounded-lg px-2.5 py-2 shadow-[var(--shadow-inset-sm)]"
                  >
                    <span className="mt-[2px] shrink-0 font-mono text-[9px] uppercase tracking-wide text-[rgb(var(--copper))]/80">
                      {KIND_LABEL[memory.kind] ?? memory.kind}
                    </span>
                    <p className="line-clamp-2 flex-1 text-[11.5px] leading-relaxed text-ink/75">
                      {memory.text}
                    </p>
                    <span className="shrink-0 font-mono text-[9px] text-muted/50">
                      {relativeTime(memory.createdAt)}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await forget(memory.id);
                        reloadMemories();
                      }}
                      aria-label="删除记忆"
                      className="shrink-0 text-muted/40 opacity-0 transition-opacity hover:text-[#a24a3f] group-hover:opacity-100"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {memories.length > 0 ? (
              <button
                type="button"
                onClick={async () => {
                  if (user) await forgetAll(user.id);
                  reloadMemories();
                  toast('记忆已清空', 'success');
                }}
                className="mt-3 text-[11px] text-muted transition-colors hover:text-[#a24a3f]"
              >
                清空全部记忆
              </button>
            ) : null}
          </Panel>

          <Panel title="本地数据" hint="浏览器 IndexedDB">
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[11.5px] text-muted">已用空间</span>
                <span className="font-mono text-[11px] text-ink/75">
                  {usage ? `${formatBytes(usage.used)} / ${formatBytes(usage.quota)}` : '读取中'}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full shadow-[var(--shadow-inset-sm)]">
                <div
                  className="h-full rounded-full bg-[rgb(var(--accent))]/45"
                  style={{
                    width: usage && usage.quota ? `${Math.min((usage.used / usage.quota) * 100, 100)}%` : '0%',
                  }}
                />
              </div>
              <p className="text-[10.5px] leading-relaxed text-muted/65">
                作品、记忆、账户与端点配置都在这块空间里。清理浏览器数据会一并删除，建议先导出备份。
              </p>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="soft" size="sm" onClick={exportAll}>
                <Download size={12} />
                导出备份
              </Button>
              <Button
                variant="soft"
                size="sm"
                onClick={() => setWipeOpen(true)}
                className="text-[#8c3b32]"
              >
                <Trash2 size={12} />
                清空数据
              </Button>
            </div>

            <div className="mt-5 rounded-lg px-3 py-2.5 shadow-[var(--shadow-inset-sm)]">
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <KeyRound size={12} />
                账户：
                <span className="font-mono text-[10.5px] text-ink/70">
                  {user?.guest ? '访客（临时）' : user?.email || '未登录'}
                </span>
              </div>
            </div>
          </Panel>
        </div>

        <Panel title="关于" hint={`v${process.env.NEXT_PUBLIC_APP_VERSION ?? '0.3'} · 本地优先`}>
          <div className="grid grid-cols-1 gap-4 text-[11px] leading-relaxed text-muted md:grid-cols-2">
            <p>
              <span className="text-ink/85">已有</span>：文本流式起草、图像生成与程序化兜底、
              录音转写、时间线裁切、分镜编排、本地账户与记忆检索。
            </p>
            <p>
              <span className="text-ink/85">尚未</span>：服务端成片渲染、跨设备同步、云端协作房间。
              实时链路目前只覆盖同一设备。
            </p>
          </div>
        </Panel>
      </div>

      <Dialog
        open={wipeOpen}
        onClose={() => setWipeOpen(false)}
        title="清空本地数据"
        description="这一步会删除账户、作品、记忆与端点配置，无法撤销。"
      >
        <div className="flex items-start gap-3 rounded-lg bg-[#f3e2df] px-3.5 py-3 text-[11.5px] leading-relaxed text-[#8c3b32]">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          如果还没有导出备份，建议先返回上一页点「导出备份」。
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="ghost" size="md" className="flex-1" onClick={() => setWipeOpen(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            size="md"
            className="flex-1 bg-[#8c3b32] hover:bg-[#7d332b]"
            onClick={wipe}
          >
            确认清空
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function SecretInput({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="mb-1.5 block text-[10.5px] text-muted">API Key</label>
      <div className="relative">
        <Input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="sk-..."
          className="h-9 pr-9 font-mono text-[11px]"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? '隐藏密钥' : '显示密钥'}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted/60 transition-colors hover:text-ink"
        >
          {visible ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
    </div>
  );
}
