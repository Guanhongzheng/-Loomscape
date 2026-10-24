import {
  AudioLines,
  BookOpen,
  Clapperboard,
  Frame,
  PenLine,
  Settings2,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type WorkbenchTile = {
  href: string;
  index: string;
  title: string;
  desc: string;
  meta: string;
  icon: LucideIcon;
  span: string;
};

export const WORKBENCHES: WorkbenchTile[] = [
  {
    href: '/studio/text',
    index: '01',
    title: '文本',
    desc: '起草、重写、切换语气。云端流式或本地推理，可中断。',
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
    desc: '浏览器内录音、波形走查、声音转写与朗读。',
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
    span: '',
  },
  {
    href: '/studio/settings',
    index: '07',
    title: '设置',
    desc: '端点、模型、引擎与记忆。全部存在本机。',
    meta: 'endpoint · engine · data',
    icon: Settings2,
    span: '',
  },
];

export const KIND_LABEL: Record<string, string> = {
  text: '文本',
  image: '图像',
  video: '影像',
  voice: '声音',
  story: '故事',
};

export const KIND_HREF: Record<string, string> = {
  text: '/studio/text',
  image: '/studio/image',
  video: '/studio/video',
  voice: '/studio/voice',
  story: '/studio/story',
};
