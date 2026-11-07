'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Cpu, HardDrive, MessagesSquare, Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { listChats, type ChatSummary } from '@/lib/chats';
import { listMemories } from '@/lib/memory';
import { listProjects, relativeTime, type Project } from '@/lib/projects';
import { useMounted } from '@/hooks/use-mounted';
import { EmptyState } from '@/components/studio/workbench';
import { KIND_HREF, KIND_LABEL, WORKBENCHES } from '@/lib/workbenches';
import {
  ALL_LOCAL_MODELS,
  findModel,
  formatBytes,
  useEngines,
  useModelRuntime,
} from '@/lib/engines';
import { backendLabel, scanModelCache, type CacheStats } from '@/lib/local-runtime';
import { channelReady, needsVaultUnlock, useEndpoints } from '@/lib/endpoint-store';
import { storageUsage, type StorageUsage } from '@/lib/storage';
import { PROJECT_KINDS, summariseOverview } from '@/lib/overview';

type OverviewData = {
  projects: Project[];
  chats: ChatSummary[];
  memories: number;
  cache: Record<string, CacheStats>;
  usage: StorageUsage | null;
};

const EMPTY: OverviewData = { projects: [], chats: [], memories: 0, cache: {}, usage: null };

const CREATE_TOOLS = ['文本', '图像', '影像', '声音', '故事'];

/**
 * The overview is the one screen that can answer "what do I have here?".
 * Shortcut tiles alone made it a menu; the cards below read the local library,
 * engine, cache and conversations so the page is different every time it is
 * opened and every link has a next action.
 */
export function StudioOverview() {
  const { user } = useAuth();
  const mounted = useMounted();
  const [data, setData] = useState<OverviewData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const prefs = useEngines((state) => state.prefs);
  const residents = useModelRuntime((state) => state.residents);
  const endpoints = useEndpoints((state) => state.endpoints);
  const health = useEndpoints((state) => state.health);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let alive = true;
    void (async () => {
      const [projects, chats, memories, cache, usage] = await Promise.all([
        listProjects(user.id),
        listChats(user.id),
        listMemories(user.id),
        scanModelCache(ALL_LOCAL_MODELS),
        storageUsage(),
      ]);
      if (!alive) return;
      setData({ projects, chats, memories: memories.length, cache, usage });
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // A model load changes the cache totals; a new project/chat remounts this
    // page anyway. Re-reading on resident count keeps the state card honest.
  }, [user, residents.length]);

  const summary = useMemo(() => summariseOverview(data), [data]);
  const latest = summary.latest;

  const textModel = findModel(prefs.textModelId);
  const textResident = residents.find((row) => row.task === 'text');
  const sealed = needsVaultUnlock({ endpoints, health }, 'text');
  const cloudReady = channelReady({ endpoints, health }, 'text');
  const engine =
    prefs.textMode === 'local'
      ? {
          label: textModel?.label ?? '未选择模型',
          note: textResident ? `已加载 · ${backendLabel(textResident.backend)}` : '未加载',
        }
      : sealed
        ? { label: '密钥保险箱已锁定', note: '去设置解锁' }
        : cloudReady
          ? { label: endpoints.text.model, note: '云端端点已连接' }
          : { label: '未配置端点', note: '在设置里连接' };

  const hour = mounted ? new Date().getHours() : 9;
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  const today = mounted
    ? new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
    : '';
  const storagePercent = Math.round(summary.storageRatio * 100);
  const maxKind = Math.max(...PROJECT_KINDS.map((kind) => summary.kindCounts[kind]), 1);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.3em] text-muted/80">
            {today || '\u00a0'}
          </div>
          <h1 className="mt-3 font-serif text-[36px] leading-[1.08] tracking-[0.01em] text-ink">
            {greeting}
            {user ? `，${user.handle}` : ''}
          </h1>
          <p className="mt-3 text-[13.5px] text-muted">
            从上次停下的地方继续，或开一条新的线。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted/65">
            {summary.projectCount} 件作品 · {summary.chatCount} 个会话
          </span>
          <Link
            href="/studio/create"
            data-overview-action="new"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[rgb(var(--accent))] px-4 text-[12.5px] text-[rgb(var(--surface))] shadow-[var(--shadow-accent)] transition-colors hover:bg-[rgb(var(--accent))]/92"
          >
            <Plus size={13} strokeWidth={2} />
            新建创作
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <section
          data-overview="continue"
          className="neu relative flex min-h-[280px] flex-col overflow-hidden rounded-2xl p-6 xl:col-span-7"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-60 w-60 rounded-full bg-[rgb(var(--copper))]/[0.1] blur-3xl"
          />
          <div className="relative flex items-start justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-muted/60">
              continue · 继续上次
            </span>
            <span className="font-serif text-[42px] leading-none text-ink/10">01</span>
          </div>

          {latest ? (
            <>
              <div className="relative mt-5 flex flex-wrap items-center gap-2.5 text-[11px]">
                <span className="rounded-full border border-white/60 bg-white/40 px-2.5 py-1 text-muted backdrop-blur-md">
                  {KIND_LABEL[latest.kind]}
                </span>
                <span className="text-muted/70">更新于 {relativeTime(latest.updatedAt)}</span>
              </div>
              <h2 className="relative mt-3 max-w-[32ch] font-serif text-[32px] leading-tight text-ink">
                {latest.title}
              </h2>
              <p className="relative mt-2 line-clamp-2 max-w-[48ch] text-[13px] leading-relaxed text-muted">
                {latest.summary || '这件作品还没有摘要，打开工作台继续。'}
              </p>
              <div className="relative mt-6 flex flex-wrap gap-x-8 gap-y-2 border-t border-white/40 pt-4">
                <div>
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-muted/50">
                    created
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink/80">
                    {relativeTime(latest.createdAt)}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-muted/50">
                    updated
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink/80">
                    {relativeTime(latest.updatedAt)}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-muted/50">
                    kind
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink/80">{KIND_LABEL[latest.kind]}</div>
                </div>
              </div>
              <div className="relative mt-auto flex flex-wrap items-center gap-3 pt-7">
                <Link
                  href={KIND_HREF[latest.kind] ?? '/studio/create'}
                  data-overview-link="continue"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[rgb(var(--accent))] px-4 text-[12.5px] text-[rgb(var(--surface))] shadow-[var(--shadow-accent)] transition-colors hover:bg-[rgb(var(--accent))]/92"
                >
                  继续编辑
                  <ArrowUpRight size={13} strokeWidth={2} />
                </Link>
                <span className="text-[11px] text-muted/60">共 {summary.projectCount} 件作品</span>
              </div>
            </>
          ) : (
            <>
              <h2 className="relative mt-6 font-serif text-[34px] leading-tight text-ink">
                从一句话开始
              </h2>
              <p className="relative mt-2 max-w-[42ch] text-[13px] leading-relaxed text-muted">
                还没有保存的作品。写一句提纲、选一种语气，结果会留在这台设备上。
              </p>
              <div className="relative mt-auto flex flex-wrap gap-1.5 pt-6">
                {CREATE_TOOLS.map((tool) => (
                  <span
                    key={tool}
                    className="rounded-full border border-white/55 bg-white/35 px-2.5 py-1 text-[10.5px] text-muted backdrop-blur-md"
                  >
                    {tool}
                  </span>
                ))}
              </div>
              <Link
                href="/studio/create"
                data-overview-link="continue"
                className="relative mt-6 inline-flex h-9 w-fit items-center gap-1.5 rounded-xl bg-[rgb(var(--accent))] px-4 text-[12.5px] text-[rgb(var(--surface))] shadow-[var(--shadow-accent)] transition-colors hover:bg-[rgb(var(--accent))]/92"
              >
                打开创作工作台
                <ArrowUpRight size={13} strokeWidth={2} />
              </Link>
            </>
          )}
        </section>

        <section
          data-overview="state"
          className="neu flex flex-col rounded-2xl p-6 xl:col-span-5"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-muted/60">
              local state · 本机状态
            </span>
            <span className="flex items-center gap-1.5 text-[10.5px] text-muted/65">
              <span className="h-1.5 w-1.5 rounded-full bg-[#4d7a5c]" />
              本机
            </span>
          </div>

          <dl className="mt-5 space-y-3.5 border-b border-white/40 pb-5 text-[12px]">
            <StateRow label="文本引擎" value={engine.label} note={engine.note} icon={<Cpu size={13} />} />
            <StateRow
              label="本地权重"
              value={loading ? '读取中' : `${summary.cachedModels} 个模型`}
              note={summary.cacheBytes > 0 ? formatBytes(summary.cacheBytes) : '还没有下载'}
              icon={<HardDrive size={13} />}
            />
            <div className="flex items-start justify-between gap-4">
              <dt className="flex shrink-0 items-center gap-1.5 text-muted">
                <HardDrive size={13} />
                本机存储
              </dt>
              <dd className="min-w-0 flex-1 text-right">
                <div className="text-ink/90">
                  {loading
                    ? '读取中'
                    : summary.storageQuota > 0
                      ? `${formatBytes(summary.storageUsed)} / ${formatBytes(summary.storageQuota)}`
                      : '未报告'}
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/35">
                  <div
                    className="h-full rounded-full bg-[rgb(var(--accent))]/70"
                    style={{ width: `${Math.max(storagePercent, summary.storageQuota > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <div className="mt-1 font-mono text-[9px] text-muted/55">
                  {summary.storageQuota > 0 ? `${storagePercent}% · IndexedDB / Cache Storage` : '浏览器未给出配额'}
                </div>
              </dd>
            </div>
            <StateRow
              label="会话"
              value={loading ? '读取中' : `${summary.chatCount} 个`}
              note={summary.recentChats[0]?.title ?? '还没有会话'}
              icon={<MessagesSquare size={13} />}
            />
          </dl>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { value: summary.projectCount, label: '作品' },
              { value: summary.chatCount, label: '会话' },
              { value: data.memories, label: '记忆' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-white/45 bg-white/25 px-2 py-2 text-center">
                <div className="font-serif text-[20px] leading-none text-ink">{stat.value}</div>
                <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted/60">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          <Link
            href="/studio/settings"
            className="mt-auto inline-flex items-center gap-1.5 pt-5 text-[11.5px] text-[rgb(var(--copper))] hover:underline"
          >
            打开设置
            <ArrowUpRight size={12} strokeWidth={2} />
          </Link>
        </section>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {WORKBENCHES.map((tile) => {
          const Icon = tile.icon;
          const count =
            tile.href === '/studio/create'
              ? summary.projectCount
              : tile.href === '/studio/chat'
                ? summary.chatCount
                : null;
          return (
            <Link
              key={tile.href}
              href={tile.href}
              data-workbench={tile.index}
              className="neu-sm group flex items-center gap-3 rounded-xl p-4 hover:border-[rgb(var(--copper))]/45"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/50 bg-white/35 text-[rgb(var(--accent))] backdrop-blur-md">
                <Icon size={15} strokeWidth={1.6} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-ink">{tile.title}</span>
                <span className="mt-0.5 block truncate font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted/60">
                  {tile.meta}
                </span>
              </span>
              {count !== null && count > 0 ? (
                <span className="font-mono text-[10.5px] text-muted/65">{count}</span>
              ) : (
                <ArrowUpRight
                  size={13}
                  className="text-muted/35 transition-colors group-hover:text-[rgb(var(--copper))]"
                />
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-10 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section data-overview="recent">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-serif text-[19px] text-ink">最近的痕迹</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted/60">
              {summary.projectCount > 0 ? `全部 ${summary.projectCount} 件` : 'local archive'}
            </span>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <div key={index} className="skeleton h-14 rounded-xl" />
              ))}
            </div>
          ) : summary.recentProjects.length === 0 ? (
            <EmptyState
              title="还没有留下痕迹"
              description="任何一次生成或保存都会出现在这里，只写在这台设备的浏览器里。"
              action={
                <Link
                  href="/studio/create"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/60 bg-white/35 px-4 text-[12px] text-ink backdrop-blur-md hover:bg-white/45"
                >
                  开始第一件作品
                  <ArrowUpRight size={13} />
                </Link>
              }
            />
          ) : (
            <div className="neu overflow-hidden rounded-2xl">
              {summary.recentProjects.map((project) => (
                <Link
                  key={project.id}
                  href={KIND_HREF[project.kind] ?? '/studio'}
                  data-project={project.id}
                  className="group flex items-center gap-4 border-b border-white/35 px-5 py-4 transition-colors last:border-0 hover:bg-white/25"
                >
                  <span className="w-12 shrink-0 font-mono text-[10.5px] tracking-wide text-muted/70">
                    {KIND_LABEL[project.kind]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] text-ink/95">{project.title}</div>
                    <div className="mt-0.5 truncate text-[11.5px] text-muted/80">
                      {project.summary || '没有摘要'}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[10.5px] text-muted/60">
                    {relativeTime(project.updatedAt)}
                  </span>
                  <ArrowUpRight
                    size={13}
                    className="shrink-0 text-muted/30 transition-colors group-hover:text-[rgb(var(--copper))]"
                  />
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="neu rounded-2xl p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-serif text-[17px] text-ink">最近会话</h2>
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted/55">
                {summary.chatCount} 个
              </span>
            </div>
            {summary.recentChats.length === 0 ? (
              <p className="mt-3 text-[11.5px] leading-relaxed text-muted/75">
                还没有保存的对话。在对话页发第一句话，它会出现在这里。
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {summary.recentChats.map((row) => (
                  <li key={row.id} data-chat={row.id}>
                    <Link
                      href="/studio/chat"
                      className="group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-white/25"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-ink/90">{row.title}</span>
                        <span className="mt-0.5 block font-mono text-[9.5px] text-muted/55">
                          {relativeTime(row.updatedAt)} · {row.turns} 轮
                        </span>
                      </span>
                      <ArrowUpRight
                        size={12}
                        className="shrink-0 text-muted/30 transition-colors group-hover:text-[rgb(var(--copper))]"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/studio/chat"
              className="mt-3 inline-flex items-center gap-1 text-[11px] text-[rgb(var(--copper))] hover:underline"
            >
              打开对话
              <ArrowUpRight size={11} />
            </Link>
          </section>

          <section className="neu rounded-2xl p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-serif text-[17px] text-ink">作品分布</h2>
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted/55">
                by kind
              </span>
            </div>
            {summary.projectCount === 0 ? (
              <p className="mt-3 text-[11.5px] leading-relaxed text-muted/75">
                保存作品后，这里会显示五种材料的比例。
              </p>
            ) : (
              <div className="mt-4 space-y-2.5">
                {PROJECT_KINDS.map((kind) => {
                  const count = summary.kindCounts[kind];
                  return (
                    <div key={kind} className="flex items-center gap-2.5">
                      <span className="w-9 shrink-0 text-[10.5px] text-muted/75">
                        {KIND_LABEL[kind]}
                      </span>
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/35">
                        <div
                          className="h-full rounded-full bg-[rgb(var(--accent))]/70"
                          style={{ width: count > 0 ? `${Math.max((count / maxKind) * 100, 4)}%` : '0%' }}
                        />
                      </div>
                      <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted/65">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function StateRow({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="flex shrink-0 items-center gap-1.5 text-muted">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 text-right">
        <div className="truncate text-[12.5px] text-ink/90">{value}</div>
        <div className="mt-0.5 truncate font-mono text-[9.5px] text-muted/60">{note}</div>
      </dd>
    </div>
  );
}
