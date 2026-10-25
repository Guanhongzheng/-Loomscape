import {
  LayoutGrid,
  MessagesSquare,
  Settings2,
  Sparkles,
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
    href: '/studio/create',
    index: '01',
    title: '创作',
    desc: '文本、图像、影像、声音、故事，五个工具收在同一个模块里。',
    meta: 'text · image · video · audio · story',
    icon: Sparkles,
    span: '',
  },
  {
    href: '/studio/chat',
    index: '02',
    title: '对话',
    desc: '多轮流式问答，先检索知识库再作答，引用逐条可查。',
    meta: 'stream · rag · citation',
    icon: MessagesSquare,
    span: '',
  },
  {
    href: '/studio/social',
    index: '03',
    title: '社交',
    desc: '用 UID 建立通讯录，同一浏览器多标签实时对话。',
    meta: 'uid · contact · channel',
    icon: Users,
    span: '',
  },
  {
    href: '/studio/settings',
    index: '04',
    title: '设置',
    desc: '引擎、端点、密钥与记忆。全部存在本机。',
    meta: 'engine · endpoint · data',
    icon: Settings2,
    span: '',
  },
];

/** Dock order: the overview sits first, then the workbenches in sequence. */
export const DOCK: WorkbenchTile[] = [
  {
    href: '/studio',
    index: '00',
    title: '总览',
    desc: '',
    meta: '',
    icon: LayoutGrid,
    span: '',
  },
  ...WORKBENCHES,
];

export const KIND_LABEL: Record<string, string> = {
  text: '文本',
  image: '图像',
  video: '影像',
  voice: '声音',
  story: '故事',
};

export const KIND_HREF: Record<string, string> = {
  text: '/studio/create?tab=text',
  image: '/studio/create?tab=image',
  video: '/studio/create?tab=video',
  voice: '/studio/create?tab=voice',
  story: '/studio/create?tab=story',
};
