'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Download, ImagePlus, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, Panel, WorkbenchHeader } from '@/components/studio/workbench';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { listProjects, saveProject, type Project } from '@/lib/projects';
import { remember } from '@/lib/memory';

type Panel = { id: string; text: string; image?: string; note?: string };

export default function StoryWorkbench() {
  const { user } = useAuth();
  const [title, setTitle] = useState('未命名分镜');
  const [panels, setPanels] = useState<Panel[]>([
    { id: 'p1', text: '' },
    { id: 'p2', text: '' },
  ]);
  const [archive, setArchive] = useState<Project[]>([]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    listProjects(user.id, 'image')
      .then((rows) => setArchive(rows))
      .catch(() => setArchive([]));
  }, [user]);

  const patch = (id: string, next: Partial<Panel>) => {
    setPanels((rows) => rows.map((row) => (row.id === id ? { ...row, ...next } : row)));
  };

  const add = () => {
    setPanels((rows) => [...rows, { id: `p${Date.now()}`, text: '' }]);
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= panels.length) return;
    setPanels((rows) => {
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const exportMarkdown = () => {
    const body = [
      `# ${title}`,
      '',
      ...panels.map((panel, index) => {
        const lines = [`## ${String(index + 1).padStart(2, '0')}`];
        if (panel.note) lines.push(`> 画面：${panel.note}`);
        lines.push('', panel.text || '（待补文字）', '');
        return lines.join('\n');
      }),
      `---`,
      `导出时间：${new Date().toLocaleString('zh-CN')}`,
    ].join('\n');

    const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title || 'storyboard'}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const keep = async () => {
    if (!user) return;
    const filled = panels.filter((panel) => panel.text.trim() || panel.image);
    if (filled.length === 0) {
      toast('至少写一格内容', 'error');
      return;
    }
    await saveProject({
      owner: user.id,
      kind: 'story',
      title,
      summary: `${filled.length} 格 · ${filled.map((p) => p.text).join(' ').slice(0, 60)}`,
      payload: {
        title,
        panels: filled.map((panel) => ({
          text: panel.text,
          image: panel.image ?? null,
          note: panel.note ?? null,
        })),
      },
    });
    void remember({
      owner: user.id,
      kind: 'story',
      text: `${title}：${filled.map((p) => p.text).join(' ').slice(0, 180)}`,
      tags: ['story'],
    });
    toast('分镜已保存', 'success');
  };

  const chars = panels.reduce((sum, panel) => sum + panel.text.length, 0);

  return (
    <div>
      <WorkbenchHeader
        index="05"
        title="多模态故事"
        description="把文字与画面排成分镜。每格可以挂一张归档画面，导出成 Markdown 或存为作品。"
        actions={
          <>
            <Button variant="soft" size="sm" onClick={exportMarkdown}>
              <Download size={13} />
              导出
            </Button>
            <Button variant="primary" size="sm" onClick={keep}>
              <Save size={13} />
              保存
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-5">
          <Panel bodyClassName="p-5">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-12 border-0 bg-transparent px-0 font-serif text-[22px] shadow-none focus:shadow-none"
              placeholder="给这个故事一个名字"
            />
            <div className="mt-1 flex items-center gap-4 font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted/55">
              <span>{panels.length} 格</span>
              <span>{chars} 字</span>
              <span>本地草稿</span>
            </div>
          </Panel>

          {panels.length === 0 ? (
            <EmptyState title="空画布" description="加一格，写一句，再决定要不要配画面。" />
          ) : (
            panels.map((panel, index) => (
              <div key={panel.id} className="neu rounded-2xl p-4">
                <div className="flex gap-4">
                  <div className="w-[38%] shrink-0">
                    {panel.image ? (
                      <div className="group relative overflow-hidden rounded-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={panel.image}
                          alt={panel.note ?? ''}
                          className="aspect-[4/3] w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => patch(panel.id, { image: undefined, note: undefined })}
                          className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-[rgb(var(--paper))]/85 text-muted opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 hover:text-[#a24a3f]"
                          aria-label="移除画面"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPickerFor(panel.id)}
                        className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[rgb(var(--line))] text-muted/60 shadow-[var(--shadow-inset-sm)] transition-colors hover:border-[rgb(var(--muted))]/40 hover:text-ink"
                      >
                        <ImagePlus size={17} strokeWidth={1.5} />
                        <span className="text-[10.5px]">挂一张画面</span>
                      </button>
                    )}
                    {panel.note ? (
                      <p className="mt-2 line-clamp-2 font-mono text-[9.5px] leading-relaxed text-muted/60">
                        {panel.note}
                      </p>
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-[10px] tracking-[0.2em] text-muted/60">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                          aria-label="上移"
                          className="grid h-6 w-6 place-items-center rounded text-muted/60 transition-colors hover:text-ink disabled:opacity-30"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(index, 1)}
                          disabled={index === panels.length - 1}
                          aria-label="下移"
                          className="grid h-6 w-6 place-items-center rounded text-muted/60 transition-colors hover:text-ink disabled:opacity-30"
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPanels((rows) => rows.filter((row) => row.id !== panel.id))}
                          aria-label="删除"
                          className="grid h-6 w-6 place-items-center rounded text-muted/60 transition-colors hover:text-[#a24a3f]"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    <Textarea
                      rows={5}
                      value={panel.text}
                      onChange={(event) => patch(panel.id, { text: event.target.value })}
                      placeholder="这一格发生什么？写动作与可见的细节，不写解释。"
                      className="text-[12.5px] leading-[1.9]"
                    />
                  </div>
                </div>
              </div>
            ))
          )}

          <button
            type="button"
            onClick={add}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[rgb(var(--line))] py-4 text-[12px] text-muted transition-colors hover:border-[rgb(var(--muted))]/40 hover:text-ink"
          >
            <Plus size={14} />
            加一格
          </button>
        </div>

        <div className="space-y-5">
          <Panel title="结构" hint="从归档里取画面">
            {archive.length === 0 ? (
              <p className="text-[11.5px] leading-relaxed text-muted/75">
                还没有归档画面。去图像创作台生成几张，回来就能挂进分镜。
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {archive.slice(0, 8).map((item) => {
                  const data = item.payload as { src?: string; prompt?: string };
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        const target = pickerFor ?? panels[0]?.id;
                        if (!target) return;
                        patch(target, { image: data.src, note: data.prompt });
                        setPickerFor(null);
                      }}
                      className="overflow-hidden rounded-lg shadow-[var(--shadow-neu-sm)] transition-transform hover:-translate-y-0.5"
                    >
                      {data.src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={data.src} alt="" className="aspect-square w-full object-cover" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-[10.5px] leading-relaxed text-muted/60">
              点击缩略图会挂到当前选中的格子。
            </p>
          </Panel>

          <Panel title="导出">
            <ul className="space-y-2 text-[11.5px] text-muted/80">
              <li className="flex justify-between">
                <span>格式</span>
                <span className="font-mono text-[10.5px] text-ink/70">Markdown</span>
              </li>
              <li className="flex justify-between">
                <span>画面</span>
                <span className="font-mono text-[10.5px] text-ink/70">引用说明</span>
              </li>
              <li className="flex justify-between">
                <span>存储</span>
                <span className="font-mono text-[10.5px] text-ink/70">本地作品库</span>
              </li>
            </ul>
            <Button variant="soft" size="sm" className="mt-4 w-full" onClick={exportMarkdown}>
              <Download size={12} />
              下载 .md
            </Button>
          </Panel>
        </div>
      </div>

      <Dialog
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        title="选择画面"
        description="来自图像创作台的归档，已压缩到 640px。"
      >
        {archive.length === 0 ? (
          <p className="text-[12px] text-muted">归档为空。</p>
        ) : (
          <div className="grid max-h-[52vh] grid-cols-3 gap-2 overflow-y-auto">
            {archive.map((item) => {
              const data = item.payload as { src?: string; prompt?: string };
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (!pickerFor) return;
                    patch(pickerFor, { image: data.src, note: data.prompt });
                    setPickerFor(null);
                  }}
                  className="overflow-hidden rounded-lg"
                >
                  {data.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={data.src} alt={item.title} className="aspect-square w-full object-cover" />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </Dialog>
    </div>
  );
}
