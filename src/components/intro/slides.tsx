'use client';

import Link from 'next/link';
import { ArrowRight, ArrowUpRight, CircleDot, Minus } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const enter = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.06 * i, duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  }),
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.34em] text-muted">
      <span className="h-px w-8 bg-[rgb(var(--line))]" />
      {children}
    </div>
  );
}

const MATERIALS = [
  { index: '01', name: '文本', detail: '提纲 · 成稿 · 语气' },
  { index: '02', name: '图像', detail: '提示词 · 批量 · 导出' },
  { index: '03', name: '声音', detail: '录制 · 转写 · 配音' },
  { index: '04', name: '影像', detail: '裁切 · 编排 · 工程' },
];

export function SlideHero({ onEnter, onBrowse }: { onEnter: () => void; onBrowse: () => void }) {
  return (
    <div className="relative mx-auto grid h-full w-full max-w-[1560px] grid-cols-1 items-center gap-12 px-5 md:grid-cols-12 md:gap-12 md:px-8">
      <div className="md:col-span-7">
        <motion.div variants={enter} custom={0} initial="hidden" animate="show">
          <Eyebrow>Multimodal workspace · 织境</Eyebrow>
        </motion.div>

        <motion.h1
          variants={enter}
          custom={1}
          initial="hidden"
          animate="show"
          className="mt-7 font-serif text-[clamp(2.7rem,4.9vw,5rem)] font-normal leading-[1.12] tracking-[0.005em] text-ink text-balance"
        >
          把散落的材料，
          <br />
          织成一件作品。
        </motion.h1>

        <motion.p
          variants={enter}
          custom={2}
          initial="hidden"
          animate="show"
          className="mt-7 max-w-[52ch] text-[15px] leading-[1.9] text-muted text-pretty"
        >
          文字、画面、声音与时间，四种材料放在同一张工作台上。从一句提纲开始，到一支成片收尾，
          中间不必换工具，也不必把半成品搬来搬去。
        </motion.p>

        <motion.div
          variants={enter}
          custom={3}
          initial="hidden"
          animate="show"
          className="mt-10 flex flex-wrap items-center gap-3"
        >
          <Button variant="primary" size="lg" onClick={onEnter}>
            进入工作台
            <ArrowRight size={16} strokeWidth={1.8} />
          </Button>
          <Button variant="ghost" size="lg" onClick={onBrowse} className="px-4">
            翻阅能力
          </Button>
        </motion.div>

        <motion.div
          variants={enter}
          custom={4}
          initial="hidden"
          animate="show"
          className="mt-14 flex items-center gap-6 font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted/75"
        >
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--copper))]" />
            本地优先
          </span>
          <span className="hidden sm:inline">滚轮 · 横向翻阅</span>
          <span>v0.1</span>
        </motion.div>
      </div>

      <motion.div
        variants={enter}
        custom={3}
        initial="hidden"
        animate="show"
        className="hidden md:col-span-5 md:block"
      >
        <div className="neu grain relative overflow-hidden rounded-[26px] p-7">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted">Index</span>
            <span className="font-mono text-[10px] text-muted/70">04 材料</span>
          </div>

          <div className="mt-6 divide-y divide-[rgb(var(--line))]/60">
            {MATERIALS.map((item) => (
              <div key={item.index} className="group flex items-baseline gap-4 py-3.5">
                <span className="font-mono text-[10px] text-muted/60">{item.index}</span>
                <span className="font-serif text-[18px] text-ink">{item.name}</span>
                <span className="ml-auto text-[11.5px] tracking-wide text-muted/80">{item.detail}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-2 border-t border-[rgb(var(--line))]/60 pt-4 text-[11px] text-muted">
            <CircleDot size={11} className="text-[rgb(var(--copper))]" />
            未连接模型服务时，工作台仍可完成一次离线走查
          </div>
        </div>

        <p className="mt-4 pl-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted/60">
          Loomscape / studio build
        </p>
      </motion.div>
    </div>
  );
}

const CAPABILITIES = [
  {
    index: '01',
    name: '文本',
    tagline: '从一句提纲到成稿',
    detail: '流式起草 · 语气切换 · 结构化重写 · 本地记忆召回',
  },
  {
    index: '02',
    name: '图像',
    tagline: '在提示词与画面之间',
    detail: '比例预设 · 批量生成 · 程序化构图兜底 · 作品归档',
  },
  {
    index: '03',
    name: '声音',
    tagline: '录制、转写、配音',
    detail: '浏览器内录音 · 实时波形 · 转写校对 · 语速与音色',
  },
  {
    index: '04',
    name: '影像',
    tagline: '在时间线上做取舍',
    detail: '片段裁切 · 顺序调整 · 播放头走查 · 工程文件导出',
  },
];

export function SlideCapabilities() {
  return (
    <div className="mx-auto grid h-full w-full max-w-[1560px] grid-cols-1 items-center gap-10 px-5 md:grid-cols-12 md:px-8">
      <div className="md:col-span-4">
        <Eyebrow>Capability</Eyebrow>
        <h2 className="mt-6 font-serif text-[clamp(1.9rem,3.2vw,2.7rem)] leading-[1.25] text-ink">
          四种材料，
          <br />
          一套工序。
        </h2>
        <p className="mt-6 max-w-[38ch] text-[14px] leading-[1.9] text-muted">
          每种材料都有独立的编辑面，但共享同一个项目、同一份记忆、同一套导出规则。
          你不必为一个想法反复切换上下文。
        </p>
      </div>

      <div className="md:col-span-8">
        <div className="neu rounded-[26px] px-7 py-3 md:px-9">
          {CAPABILITIES.map((item) => (
            <div
              key={item.index}
              className="group relative flex items-center gap-5 border-b border-[rgb(var(--line))]/55 py-5 last:border-0"
            >
              <span className="absolute left-0 top-1/2 h-px w-0 -translate-y-1/2 bg-[rgb(var(--copper))]/70 transition-all duration-500 ease-weave group-hover:w-6" />
              <span className="w-6 font-mono text-[10px] text-muted/60 transition-transform duration-500 ease-weave group-hover:translate-x-7">
                {item.index}
              </span>
              <div className="w-[4.5rem] shrink-0 transition-transform duration-500 ease-weave group-hover:translate-x-6">
                <span className="font-serif text-[19px] text-ink">{item.name}</span>
              </div>
              <div className="min-w-0 transition-transform duration-500 ease-weave group-hover:translate-x-6">
                <div className="text-[13px] text-ink/85">{item.tagline}</div>
                <div className="mt-1 truncate font-mono text-[10.5px] tracking-wide text-muted/70">
                  {item.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  {
    index: '01',
    title: '采集',
    en: 'Capture',
    body: '把散落的素材、参考、只言片语收进同一个项目。文本、截图、录音、片段各有归处，不再散落在五个文件夹里。',
    points: ['多模态导入', '项目级上下文', '本地暂存'],
  },
  {
    index: '02',
    title: '编织',
    en: 'Weave',
    body: '在画布与时间线之间来回。每一次重写、每一版构图都保留理由，回到任何一个节点都能看清当时为什么这样改。',
    points: ['流式改稿', '版本对照', '记忆召回'],
  },
  {
    index: '03',
    title: '落定',
    en: 'Settle',
    body: '导出成稿、分镜或工程文件。喜欢的作品进入归档，偏好沉淀为下一次的默认值，而不是重新开始。',
    points: ['多格式导出', '作品归档', '偏好沉淀'],
  },
];

export function SlideProcess() {
  return (
    <div className="mx-auto flex h-full w-full max-w-[1560px] flex-col justify-center px-5 md:px-8">
      <Eyebrow>Workflow</Eyebrow>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <h2 className="font-serif text-[clamp(1.9rem,3.2vw,2.7rem)] leading-[1.25] text-ink">
          三步，从草稿到成品。
        </h2>
        <p className="max-w-[38ch] text-[13px] leading-[1.9] text-muted">
          工序是固定的，选择是自由的。你可以停在任何一步，也可以随时退回上一步重来。
        </p>
      </div>

      <div className="relative mt-14">
        <div className="absolute left-0 right-0 top-[9px] h-px bg-[rgb(var(--line))]" />
        <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.index}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.08 * i, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="relative pl-1"
            >
              <span className="relative -top-[3px] block h-[7px] w-[7px] rounded-full bg-[rgb(var(--copper))] shadow-[0_0_0_4px_rgb(var(--paper))]" />
              <div className="mt-6 flex items-baseline gap-3">
                <span className="font-mono text-[10px] text-muted/60">{step.index}</span>
                <h3 className="font-serif text-[26px] text-ink">{step.title}</h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted/60">
                  {step.en}
                </span>
              </div>
              <p className="mt-4 max-w-[34ch] text-[13px] leading-[1.95] text-muted">{step.body}</p>
              <ul className="mt-5 space-y-1.5">
                {step.points.map((point) => (
                  <li key={point} className="flex items-center gap-2 text-[11.5px] text-ink/60">
                    <Minus size={10} className="text-[rgb(var(--copper))]/70" />
                    {point}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SlideAbout({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="mx-auto grid h-full w-full max-w-[1560px] grid-cols-1 content-center gap-12 px-5 md:grid-cols-12 md:px-8">
      <div className="md:col-span-7">
        <Eyebrow>About</Eyebrow>
        <h2 className="mt-6 font-serif text-[clamp(2rem,3.6vw,3.1rem)] leading-[1.22] text-ink text-balance">
          你的材料，
          <br />
          留在你的机器上。
        </h2>
        <p className="mt-7 max-w-[54ch] text-[14px] leading-[1.95] text-muted text-pretty">
          密钥与偏好写进浏览器的 IndexedDB，作品与记忆不出本机。端侧模型可以离线跑一个小模型兜底，
          服务端只在你主动配置时才参与。没有账号同步，没有遥测，也没有一张你不知道用途的埋点表。
        </p>

        <div className="mt-10 grid grid-cols-3 gap-4 md:max-w-[26rem]">
          {[
            { value: '0', label: '服务端作品副本' },
            { value: '3', label: '离线可用工作台' },
            { value: '1', label: '份配置，可导出' },
          ].map((item) => (
            <div key={item.label}>
              <div className="font-serif text-[30px] leading-none text-ink">{item.value}</div>
              <div className="mt-2 text-[11px] leading-relaxed text-muted/80">{item.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-11 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" onClick={onEnter}>
            进入工作台
            <ArrowRight size={16} strokeWidth={1.8} />
          </Button>
          <Link
            href="https://github.com/Guanhongzheng/Loomscape"
            target="_blank"
            rel="noreferrer"
            className={cn(
              'inline-flex h-[3.25rem] items-center gap-2 rounded-2xl px-5 text-[14px] text-muted',
              'transition-colors duration-300 hover:text-ink',
            )}
          >
            查看源码
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>

      <div className="hidden md:col-span-5 md:block md:pl-6">
        <div className="neu-inset grain rounded-[26px] p-7">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted/80">
            System
          </div>
          <dl className="mt-5 space-y-4">
            {[
              ['渲染', 'Next.js App Router · RSC'],
              ['动效', 'Framer Motion · WebGL threads'],
              ['存储', 'IndexedDB · localStorage'],
              ['流式', 'SSE · ReadableStream'],
              ['模型', '可配置端点 · 兼容协议'],
            ].map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-4 border-b border-[rgb(var(--line))]/50 pb-3 last:border-0 last:pb-0">
                <dt className="text-[11.5px] text-muted">{key}</dt>
                <dd className="text-right font-mono text-[11px] text-ink/75">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="mt-4 pl-1 text-[11px] leading-relaxed text-muted/60">
          当前构建以本地优先为前提，未接入托管账号与云端存储。
        </p>
      </div>
    </div>
  );
}
