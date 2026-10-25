'use client';

import { useState } from 'react';
import {
  AudioLines,
  BookOpen,
  Clapperboard,
  Frame,
  PenLine,
  type LucideIcon,
} from 'lucide-react';
import { ChannelBadge, WorkbenchHeader } from '@/components/studio/workbench';
import type { Channel } from '@/lib/providers';
import type { CreateTab } from '@/lib/create-tabs';
import { cn } from '@/lib/cn';
import TextWorkbench from './text-workbench';
import ImageWorkbench from './image-workbench';
import VideoWorkbench from './video-workbench';
import VoiceWorkbench from './voice-workbench';
import StoryWorkbench from './story-workbench';

type TabDef = {
  id: CreateTab;
  label: string;
  desc: string;
  icon: LucideIcon;
  /** Endpoint channel that backs this tool, when it has one. */
  channel?: Channel;
};

const TABS: TabDef[] = [
  {
    id: 'text',
    label: '文本',
    desc: '起草、重写、切换语气。云端流式或本地推理，可中断。',
    icon: PenLine,
    channel: 'text',
  },
  {
    id: 'image',
    label: '图像',
    desc: '提示词、比例、批量。未连接服务时给出程序化构图。',
    icon: Frame,
    channel: 'image',
  },
  {
    id: 'video',
    label: '影像',
    desc: '导入片段，在时间线上裁切、排序、导出工程。',
    icon: Clapperboard,
  },
  {
    id: 'voice',
    label: '声音',
    desc: '浏览器内录音、波形走查、声音转写与朗读。',
    icon: AudioLines,
    channel: 'speech',
  },
  {
    id: 'story',
    label: '故事',
    desc: '把文字与画面排成分镜，一体导出。',
    icon: BookOpen,
  },
];

/**
 * Five tools that all start from a prompt and end in a file share one module:
 * the dock and the overview were listing them as five equal destinations,
 * which made the workspace read as a menu of pages rather than one studio.
 * Tabs switch the tool; only the active one is mounted, so drafts do not pile
 * up in memory.
 */
export function CreateWorkspace({ initialTab = 'text' }: { initialTab?: CreateTab }) {
  const [tab, setTab] = useState<CreateTab>(initialTab);
  const active = TABS.find((row) => row.id === tab) ?? TABS[0];

  return (
    <div>
      <WorkbenchHeader
        index="01"
        title="创作"
        description={active.desc}
        actions={active.channel ? <ChannelBadge channel={active.channel} /> : null}
      />

      {/* One row on phones too: wrapping pushed 故事 onto a line of its own. */}
      <div
        role="tablist"
        aria-label="创作工具"
        className="no-scrollbar mb-5 flex gap-1.5 overflow-x-auto"
      >
        {TABS.map((row) => {
          const Icon = row.icon;
          const on = row.id === tab;
          return (
            <button
              key={row.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(row.id)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-[12px] transition-all duration-300 ease-weave',
                on
                  ? 'bg-[rgb(var(--surface))] text-ink shadow-[var(--shadow-neu-sm)]'
                  : 'text-muted hover:bg-[rgb(var(--surface))]/55 hover:text-ink',
              )}
            >
              <Icon
                size={14}
                strokeWidth={1.7}
                className={on ? 'text-[rgb(var(--accent))]' : 'text-muted/70'}
              />
              {row.label}
            </button>
          );
        })}
      </div>

      {tab === 'text' ? <TextWorkbench /> : null}
      {tab === 'image' ? <ImageWorkbench /> : null}
      {tab === 'video' ? <VideoWorkbench /> : null}
      {tab === 'voice' ? <VoiceWorkbench /> : null}
      {tab === 'story' ? <StoryWorkbench /> : null}
    </div>
  );
}
