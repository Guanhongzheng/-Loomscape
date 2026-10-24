'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { listProjects, relativeTime, type Project } from '@/lib/projects';
import { useMounted } from '@/hooks/use-mounted';
import { EmptyState } from '@/components/studio/workbench';
import { KIND_HREF, KIND_LABEL, WORKBENCHES } from '@/lib/workbenches';
import { cn } from '@/lib/cn';

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

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {WORKBENCHES.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.href}
              href={tile.href}
              className={cn(
                'neu neu-press group relative flex min-h-[182px] flex-col overflow-hidden rounded-2xl p-6',
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
                <h2 className="font-serif text-[21px] text-ink">{tile.title}</h2>
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
