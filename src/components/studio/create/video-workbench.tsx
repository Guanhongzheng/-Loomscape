'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Film, Pause, Play, Scissors, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/controls';
import { EmptyState, Panel } from '@/components/studio/workbench';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { saveProject } from '@/lib/projects';
import { cn } from '@/lib/cn';

type Clip = { id: string; from: number; to: number };

function clock(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(value, 0) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

export default function VideoWorkbench() {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<{ url: string; name: string; duration: number } | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);

  const active = clips.find((clip) => clip.id === activeId) ?? null;
  const total = clips.reduce((sum, clip) => sum + Math.max(clip.to - clip.from, 0), 0);

  useEffect(
    () => () => {
      if (source?.url) URL.revokeObjectURL(source.url);
    },
    [source],
  );

  const importFile = (file: File) => {
    if (source?.url) URL.revokeObjectURL(source.url);
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = url;
    probe.onloadedmetadata = () => {
      const duration = Number.isFinite(probe.duration) ? probe.duration : 0;
      const id = `clip_${Date.now()}`;
      setSource({ url, name: file.name, duration });
      setClips([{ id, from: 0, to: duration }]);
      setActiveId(id);
      setPosition(0);
      if (!duration) toast('无法读取时长，部分浏览器不支持该编码', 'error');
    };
    probe.onerror = () => {
      toast('这个文件无法在浏览器中预览，换一个 MP4/H.264 试试', 'error');
      URL.revokeObjectURL(url);
    };
  };

  const selectClip = (clip: Clip) => {
    setActiveId(clip.id);
    setPosition(clip.from);
    if (videoRef.current) videoRef.current.currentTime = clip.from;
  };

  const split = () => {
    if (!active) return;
    if (position <= active.from + 0.2 || position >= active.to - 0.2) {
      toast('把播放头移到片段中间再拆分', 'error');
      return;
    }
    const left: Clip = { ...active, to: position };
    const right: Clip = { id: `clip_${Date.now()}_b`, from: position, to: active.to };
    setClips((rows) => rows.flatMap((row) => (row.id === active.id ? [left, right] : [row])));
    setActiveId(right.id);
  };

  const remove = (id: string) => {
    setClips((rows) => {
      const next = rows.filter((row) => row.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  };

  const toggle = async () => {
    const video = videoRef.current;
    if (!video || !active) return;
    if (video.paused) {
      video.currentTime = Math.min(Math.max(position, active.from), active.to);
      await video.play().catch(() => toast('浏览器阻止了播放', 'error'));
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !active) return;
    setPosition(video.currentTime);

    if (video.currentTime >= active.to) {
      const index = clips.findIndex((clip) => clip.id === active.id);
      const next = clips[index + 1];
      if (next && playing) {
        setActiveId(next.id);
        video.currentTime = next.from;
      } else {
        video.pause();
        video.currentTime = active.to;
        setPlaying(false);
      }
    }
  };

  const exportManifest = async () => {
    if (!source) return;
    const payload = {
      project: source.name.replace(/\.[^.]+$/, ''),
      source: { name: source.name, duration: Number(source.duration.toFixed(3)) },
      clips: clips.map((clip, index) => ({
        order: index + 1,
        from: Number(clip.from.toFixed(3)),
        to: Number(clip.to.toFixed(3)),
        duration: Number((clip.to - clip.from).toFixed(3)),
      })),
      runtime: Number(total.toFixed(3)),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${payload.project || 'sequence'}.sequence.json`;
    link.click();
    URL.revokeObjectURL(url);

    if (user) {
      await saveProject({
        owner: user.id,
        kind: 'video',
        title: source.name,
        summary: `${clips.length} 个片段 · ${clock(total)}`,
        payload: payload as unknown as Record<string, unknown>,
      });
      toast('工程已导出并存入作品库', 'success');
    } else {
      toast('工程已导出', 'success');
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) importFile(file);
          event.target.value = '';
        }}
      />

      {!source ? (
        <Panel bodyClassName="p-6">
          <EmptyState
            title="还没有源片"
            description="支持浏览器能直接解码的格式（通常是 MP4 / H.264）。文件不会上传，只在本机内存里预览。"
            action={
              <Button variant="primary" size="md" onClick={() => inputRef.current?.click()}>
                <Film size={14} />
                选择文件
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <Panel bodyClassName="p-3" className="overflow-hidden">
              <div className="relative overflow-hidden rounded-xl bg-[#0f1319]">
                <video
                  ref={videoRef}
                  src={source.url}
                  className="max-h-[46vh] w-full object-contain"
                  onTimeUpdate={onTimeUpdate}
                  onPause={() => setPlaying(false)}
                  onPlay={() => setPlaying(true)}
                  onSeeked={() => {
                    if (videoRef.current) setPosition(videoRef.current.currentTime);
                  }}
                  playsInline
                />
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2.5 pt-8">
                  <button
                    type="button"
                    onClick={toggle}
                    className="grid h-8 w-8 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
                    aria-label={playing ? '暂停' : '播放'}
                  >
                    {playing ? <Pause size={13} /> : <Play size={13} />}
                  </button>
                  <span className="font-mono text-[10.5px] tabular-nums text-white/85">
                    {clock(position)} / {clock(source.duration)}
                  </span>
                  <span className="ml-auto truncate font-mono text-[10px] text-white/55">
                    {source.name}
                  </span>
                </div>
              </div>
            </Panel>

            <Panel title="片段" hint={`${clips.length} 段 · 总长 ${clock(total)}`}>
              <ul className="space-y-1.5">
                {clips.map((clip, index) => (
                  <li key={clip.id}>
                    <button
                      type="button"
                      onClick={() => selectClip(clip)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                        clip.id === activeId
                          ? 'bg-[rgb(var(--surface))] shadow-[var(--shadow-neu-sm)]'
                          : 'hover:bg-[rgb(var(--surface))]/60',
                      )}
                    >
                      <span className="font-mono text-[9.5px] text-muted/60">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="font-mono text-[10.5px] tabular-nums text-ink/75">
                        {clock(clip.from)} — {clock(clip.to)}
                      </span>
                      <span className="ml-auto font-mono text-[9.5px] text-muted/50">
                        {(clip.to - clip.from).toFixed(1)}s
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex gap-2">
                <Button variant="soft" size="sm" className="flex-1" onClick={split}>
                  <Scissors size={12} />
                  拆分
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => active && remove(active.id)}
                  disabled={!active}
                  aria-label="删除片段"
                >
                  <Trash2 size={12} />
                </Button>
              </div>

              <Button
                variant="primary"
                size="md"
                className="mt-5 w-full"
                onClick={exportManifest}
                disabled={clips.length === 0}
              >
                <Download size={13} />
                导出工程
              </Button>
            </Panel>
          </div>

          <Panel title="时间线" hint="点击片段选中，拖动播放头后再拆分">
            <div className="relative">
              <div className="flex h-16 gap-1">
                {clips.map((clip) => {
                  const width = source.duration ? ((clip.to - clip.from) / source.duration) * 100 : 0;
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      onClick={() => selectClip(clip)}
                      style={{ width: `${width}%` }}
                      className={cn(
                        'group relative min-w-[18px] overflow-hidden rounded-lg transition-all',
                        clip.id === activeId
                          ? 'bg-[rgb(var(--accent))]/12 shadow-[var(--shadow-inset-sm)]'
                          : 'bg-[rgb(var(--sunken))]',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute inset-x-0 top-0 h-[3px]',
                          clip.id === activeId ? 'bg-[rgb(var(--copper))]' : 'bg-[rgb(var(--line))]',
                        )}
                      />
                      <span className="absolute inset-0 grid place-items-center font-mono text-[9.5px] text-muted/70">
                        {(clip.to - clip.from).toFixed(1)}s
                      </span>
                    </button>
                  );
                })}
              </div>

              <div
                className="pointer-events-none absolute -top-1 bottom-0 w-px bg-[rgb(var(--copper))]"
                style={{ left: `${source.duration ? (position / source.duration) * 100 : 0}%` }}
              >
                <span className="absolute -left-[3px] -top-[3px] h-[7px] w-[7px] rounded-full bg-[rgb(var(--copper))]" />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Slider
                label="片段入点"
                min={0}
                max={Math.max(source.duration, 0.1)}
                step={0.1}
                value={active?.from ?? 0}
                display={clock(active?.from ?? 0)}
                onChange={(value) => {
                  if (!active) return;
                  const from = Math.min(value, active.to - 0.2);
                  setClips((rows) =>
                    rows.map((row) => (row.id === active.id ? { ...row, from } : row)),
                  );
                  if (videoRef.current) videoRef.current.currentTime = from;
                  setPosition(from);
                }}
              />
              <Slider
                label="片段出点"
                min={0}
                max={Math.max(source.duration, 0.1)}
                step={0.1}
                value={active?.to ?? 0}
                display={clock(active?.to ?? 0)}
                onChange={(value) => {
                  if (!active) return;
                  const to = Math.max(value, active.from + 0.2);
                  setClips((rows) => rows.map((row) => (row.id === active.id ? { ...row, to } : row)));
                }}
              />
            </div>

            <p className="mt-4 text-[10.5px] leading-relaxed text-muted/70">
              工程文件只记录片段区间，不包含视频本体。重新打开时需要再导入同一条源片。
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}
