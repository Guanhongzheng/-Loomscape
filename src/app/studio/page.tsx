'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Clapperboard,
  Frame,
  PenLine,
  Settings2,
  Users,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { listProjects, relativeTime, type Project } from '@/lib/projects';
import { useMounted } from '@/hooks/use-mounted';
import { EmptyState } from '@/components/studio/workbench';
import { cn } from '@/lib/cn';

const TILES = [
  {
    href: '/studio/text',
    index: '01',
    title: '文本',
    desc: '起草、重写、切换语气。流式输出，逐句可改。',
    meta: 'draft · tone · memory',
    icon: PenLine,
    span: 'lg:col-span-2',
  },
  {
    href: '/studio/image',
    index: '02',
    title: '图像',
    desc: '提示词、比例、批量。未连接服务时给出程序化构图。',
    meta: 'prompt · batch · archive',
    icon: Frame,
    span: '',
  },
  {
    href: '/studio/video',
    index: '03',
    title: '影像',
    desc: '导入片段，在时间线上裁切、排序、导出工程。',
    meta: 'trim · sequence · edl',
    icon: Clapperboard,
    span: '',
  },
  {
    href: '/studio/voice',
    index: '04',
    title: '声音',
    desc: '浏览器内录音、波形走查、浏览器朗读。',
    meta: 'record · waveform · tts',
    icon: AudioLines,
    span: '',
  },
  {
    href: '/studio/story',
    index: '05',
    title: '故事',
    desc: '把文字与画面排成分镜，一体导出。',
    meta: 'panel · board · export',
    icon: BookOpen,
    span: '',
  },
  {
    href: '/studio/social',
    index: '06',
    title: '社交',
    desc: '用 UID 建立通讯录，同一浏览器多标签实时对话。',
    meta: 'uid · contact · channel',
    icon: Users,
    span: 'lg:col-span-2',
  },
  {
    href: '/studio/settings',
    index: '07',
    title: '设置',
    desc: '端点、模型、密钥与记忆。全部存在本机。',
    meta: 'endpoint · memory · data',
    icon: Settings2,
    span: '',
  },
];

const KIND_LABEL: Record<string, string> = {
  text: '文本',
  image: '图像',
  video: '影像',
  voice: '声音',
  story: '故事',
};

const KIND_HREF: Record<string, string> = {
  text: '/studio/text',
  image: '/studio/image',
  video: '/studio/video',
  voice: '/studio/voice',
  story: '/studio/story',
};

export default function StudioOverview() {
  const { user } = useAuth();
  const mounted = useMounted();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    listProjects(user.id)
      .then((rows) => {
        if (alive) setProjects(rows.slice(0, 5));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  const hour = mounted ? new Date().getHours() : 9;
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  const today = mounted
    ? new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
    : '';

  return (
    <div>
      <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted/70">
            {today || '\u00a0'}
          </div>
          <h1 className="mt-2.5 font-serif text-[30px] leading-tight tracking-[0.01em] text-ink">
            {greeting}
            {user ? `，${user.handle}` : ''}
          </h1>
          <p className="mt-2 text-[12.5px] text-muted">
            选一种材料开始，或从上次留下的痕迹继续。
          </p>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted/60">
          {projects.length} 件作品 · 本地
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.href}
              href={tile.href}
              className={cn(
                'neu neu-press group relative flex min-h-[168px] flex-col overflow-hidden rounded-2xl p-6',
                tile.span,
              )}
            >
              <div className="flex items-start justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[rgb(var(--sunken))]/70 text-[rgb(var(--accent))] shadow-[var(--shadow-inset-sm)]">
                  <Icon size={17} strokeWidth={1.6} />
                </span>
                <span className="font-mono text-[10px] tracking-[0.2em] text-muted/45">{tile.index}</span>
              </div>

              <div className="mt-5">
                <h2 className="font-serif text-[20px] text-ink">{tile.title}</h2>
                <p className="mt-1.5 max-w-[36ch] text-[11.5px] leading-[1.75] text-muted">{tile.desc}</p>
              </div>

              <div className="mt-auto flex items-center justify-between pt-5">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted/50">
                  {tile.meta}
                </span>
                <ArrowUpRight
                  size={14}
                  className="text-muted/35 transition-all duration-300 ease-weave group-hover:-translate-y-0.5 group-hover:text-[rgb(var(--copper))]"
                />
              </div>

              <span className="pointer-events-none absolute inset-x-6 bottom-0 h-[2px] origin-left scale-x-0 rounded-full bg-[rgb(var(--copper))]/45 transition-transform duration-500 ease-weave group-hover:scale-x-100" />
            </Link>
          );
        })}
      </div>

      <section className="mt-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-serif text-[17px] text-ink">最近的痕迹</h2>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted/55">
            local archive
          </span>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-14 rounded-xl" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            title="还没有留下痕迹"
            description="任何一次生成或保存都会出现在这里，只写在这台设备的浏览器里。"
          />
        ) : (
          <div className="neu overflow-hidden rounded-2xl">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={KIND_HREF[project.kind] ?? '/studio'}
                className="group flex items-center gap-4 border-b border-[rgb(var(--line))]/50 px-5 py-4 transition-colors last:border-0 hover:bg-[rgb(var(--surface))]/60"
              >
                <span className="w-12 shrink-0 font-mono text-[10px] tracking-wide text-muted/60">
                  {KIND_LABEL[project.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink/90">{project.title}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted/75">{project.summary}</div>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-muted/55">
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
    </div>
  );
}
