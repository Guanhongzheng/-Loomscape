'use client';

import { useEffect, useState } from 'react';
import { Aperture, Download, Loader2, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { Segmented } from '@/components/ui/controls';
import { EmptyState, Panel } from '@/components/studio/workbench';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { channelReady, useEndpoints } from '@/lib/endpoint-store';
import { requestImages } from '@/lib/api';
import { renderOfflineArtwork } from '@/lib/demo';
import { compress, downloadDataUrl } from '@/lib/image-utils';
import { listProjects, relativeTime, saveProject, type Project } from '@/lib/projects';

type Aspect = '1:1' | '4:3' | '3:4' | '16:9';

const ASPECTS: Array<{ value: Aspect; label: string }> = [
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
];

const API_SIZE: Record<Aspect, string> = {
  '1:1': '1024x1024',
  '4:3': '1536x1024',
  '3:4': '1024x1536',
  '16:9': '1536x1024',
};

const LOCAL_SIZE: Record<Aspect, [number, number]> = {
  '1:1': [896, 896],
  '4:3': [1024, 768],
  '3:4': [768, 1024],
  '16:9': [1152, 648],
};

const ASPECT_CLASS: Record<Aspect, string> = {
  '1:1': 'aspect-square',
  '4:3': 'aspect-[4/3]',
  '3:4': 'aspect-[3/4]',
  '16:9': 'aspect-[16/9]',
};

type Shot = { id: string; src: string; mode: 'live' | 'offline'; prompt: string };

export default function ImageWorkbench() {
  const { user } = useAuth();
  const endpoints = useEndpoints((state) => state.endpoints);
  const health = useEndpoints((state) => state.health);
  const live = channelReady({ endpoints, health }, 'image');

  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<Aspect>('1:1');
  const [count, setCount] = useState('2');
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState<Project[]>([]);

  useEffect(() => {
    if (!user) return;
    listProjects(user.id, 'image')
      .then((rows) => setArchive(rows.slice(0, 6)))
      .catch(() => setArchive([]));
  }, [user]);

  const generate = async () => {
    const brief = prompt.trim();
    if (brief.length < 2) {
      toast('写一句画面描述', 'error');
      return;
    }
    if (busy) return;

    setBusy(true);
    try {
      if (live) {
        const images = await requestImages({
          endpoint: endpoints.image,
          prompt: brief,
          size: API_SIZE[aspect],
          count: Number(count),
        });
        setShots(
          images.map((image, index) => ({
            id: `shot_${Date.now()}_${index}`,
            src: image.dataUrl ?? image.url ?? '',
            mode: 'live' as const,
            prompt: brief,
          })),
        );
      } else {
        const [width, height] = LOCAL_SIZE[aspect];
        const total = Number(count);
        const next: Shot[] = [];
        for (let i = 0; i < total; i += 1) {
          const src = renderOfflineArtwork(`${brief}#${i}`, width, height);
          if (src) {
            next.push({ id: `shot_${Date.now()}_${i}`, src, mode: 'offline', prompt: brief });
          }
        }
        setShots(next);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : '生成失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const keep = async (shot: Shot) => {
    if (!user) return;
    try {
      const thumb = await compress(shot.src, 640);
      const record = await saveProject({
        owner: user.id,
        kind: 'image',
        title: shot.prompt,
        summary: `${aspect} · ${shot.mode === 'live' ? '服务生成' : '程序化构图'}`,
        payload: { prompt: shot.prompt, aspect, src: thumb, mode: shot.mode },
      });
      setArchive((rows) => [record, ...rows].slice(0, 6));
      toast('已存入作品库', 'success');
    } catch {
      toast('保存失败，可能是存储空间不足', 'error');
    }
  };

  const drop = async (id: string) => {
    const { deleteProject } = await import('@/lib/projects');
    await deleteProject(id);
    setArchive((rows) => rows.filter((row) => row.id !== id));
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="描述">
            <Textarea
              rows={6}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="例如：亚麻质感的织物特写，侧逆光，冷灰与铜色，极简构图"
            />

            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-2 text-[12px] font-medium tracking-wide text-muted">比例</div>
                <Segmented
                  size="sm"
                  value={aspect}
                  onChange={(next) => setAspect(next)}
                  options={ASPECTS}
                />
              </div>

              <div>
                <div className="mb-2 text-[12px] font-medium tracking-wide text-muted">数量</div>
                <Segmented
                  size="sm"
                  value={count}
                  onChange={(next) => setCount(next)}
                  options={[
                    { value: '1', label: '1 张' },
                    { value: '2', label: '2 张' },
                    { value: '4', label: '4 张' },
                  ]}
                />
              </div>
            </div>

            <Button
              variant="primary"
              size="md"
              className="mt-6 w-full"
              onClick={generate}
              disabled={busy}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Aperture size={14} />}
              {busy ? '正在出图' : '生成'}
            </Button>

            <p className="mt-3 text-[10.5px] leading-relaxed text-muted/70">
              {live
                ? `使用 ${endpoints.image.model}，单次最多 4 张。`
                : '未配置图像端点：画布由本地程序化生成，适合先定构图与色调。'}
            </p>
          </Panel>

          <Panel title="归档" hint="保存的画面会压缩到 640px">
            {archive.length === 0 ? (
              <p className="text-[11.5px] text-muted/75">还没有归档的画面。</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {archive.map((item) => {
                  const payload = item.payload as { src?: string };
                  return (
                    <div key={item.id} className="group relative overflow-hidden rounded-lg">
                      {payload.src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={payload.src}
                          alt={item.title}
                          className="aspect-square w-full object-cover"
                        />
                      ) : (
                        <div className="aspect-square w-full bg-[rgb(var(--sunken))]" />
                      )}
                      <button
                        type="button"
                        onClick={() => drop(item.id)}
                        aria-label="删除"
                        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-[rgb(var(--paper))]/85 text-muted opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 hover:text-[#a24a3f]"
                      >
                        <Trash2 size={11} />
                      </button>
                      <div className="absolute inset-x-0 bottom-0 truncate bg-[rgb(var(--paper))]/80 px-1.5 py-1 font-mono text-[8.5px] text-muted/80 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                        {relativeTime(item.updatedAt)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <Panel
          title="画布"
          hint={shots.length ? `${shots.length} 张` : '等待生成'}
          bodyClassName="p-5"
          className="min-h-[560px]"
        >
          {busy ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: Number(count) }).map((_, index) => (
                <div
                  key={index}
                  className={`skeleton rounded-xl ${ASPECT_CLASS[aspect]}`}
                  style={{ animationDelay: `${index * 120}ms` }}
                />
              ))}
            </div>
          ) : shots.length === 0 ? (
            <EmptyState
              title="画布是空的"
              description="左侧写一句描述，选好比例与数量。生成后的画面可以下载，也可以存入作品库。"
            />
          ) : (
            <div
              className={`grid gap-4 ${
                shots.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
              }`}
            >
              {shots.map((shot) => (
                <figure key={shot.id} className="group relative overflow-hidden rounded-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shot.src}
                    alt={shot.prompt}
                    className={`w-full object-cover ${ASPECT_CLASS[aspect]} shadow-[0_12px_30px_-16px_rgba(30,42,60,0.45)]`}
                  />

                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-[rgba(20,26,36,0.55)] to-transparent px-3 pb-2.5 pt-8 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/80">
                      {shot.mode === 'live' ? 'remote' : 'local canvas'}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => downloadDataUrl(shot.src, `loomscape-${Date.now()}.png`)}
                        className="grid h-7 w-7 place-items-center rounded-md bg-white/15 text-white/90 backdrop-blur transition-colors hover:bg-white/25"
                        aria-label="下载"
                      >
                        <Download size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => keep(shot)}
                        className="grid h-7 w-7 place-items-center rounded-md bg-white/15 text-white/90 backdrop-blur transition-colors hover:bg-white/25"
                        aria-label="保存"
                      >
                        <Save size={12} />
                      </button>
                    </div>
                  </div>
                </figure>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
