'use client';

import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Cloud,
  FileText,
  Image as ImageIcon,
  Monitor,
  Server,
  Video,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { HomePreview } from './home-preview';

/**
 * Slide order matches the nav: 创作 → 对话 → 底座 → 光标.
 * Copy is deliberately short: the diagram carries the explanation, the text
 * only names what the diagram cannot say by itself. `data-slide-reveal` keys
 * stay stable so the cursor build keeps working; slide one keeps exactly five
 * of them (the e2e build check counts them).
 */

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
    <div className="flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.28em] text-muted">
      <span className="h-px w-8 bg-[rgb(var(--line))]" />
      {children}
    </div>
  );
}

const STAGE_FRAME =
  'intro-stage grain relative flex w-full flex-col justify-start overflow-hidden rounded-[30px] border border-white/60 bg-white/55 p-5 shadow-[0_32px_90px_-48px_rgba(61,54,72,0.58)] backdrop-blur-2xl md:h-[clamp(440px,56vh,620px)]';
const LEFT_COL = 'md:col-span-6 md:flex md:h-[clamp(440px,56vh,620px)] md:flex-col';

/**
 * The four right-hand stages share one frame: same width, same height, same
 * frosted surface. Each slide differs in content, not in the box it sits in.
 */
function SlideStage({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn(STAGE_FRAME, className)}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent"
      />
      {children}
    </div>
  );
}

const TOOLS = [
  { key: 'text', name: '文本', icon: FileText },
  { key: 'image', name: '图像', icon: ImageIcon },
  { key: 'video', name: '影像', icon: Video },
  { key: 'voice', name: '声音', icon: AudioLines },
  { key: 'story', name: '故事', icon: BookOpen },
];

export function SlideHero({ onEnter, onBrowse }: { onEnter: () => void; onBrowse: () => void }) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative mx-auto grid h-full w-full max-w-[1400px] grid-cols-1 items-center gap-7 px-4 md:grid-cols-12 md:gap-10 md:px-8">
      <div className={LEFT_COL}>
        <div data-slide-reveal="hero-heading">
          <motion.div
            variants={enter}
            custom={0}
            initial="hidden"
            animate="show"
            className="hidden sm:block"
          >
            <Eyebrow>01 · 创作</Eyebrow>
          </motion.div>

          <motion.h1
            variants={enter}
            custom={1}
            initial="hidden"
            animate="show"
            className="mt-4 max-w-[16ch] text-[clamp(3rem,5.1vw,5rem)] font-semibold leading-[1.1] tracking-[0.005em] text-ink text-balance sm:mt-6"
          >
            <span className="block overflow-hidden pb-[0.08em]">
              <motion.span
                className="block"
                initial={reduceMotion ? false : { y: '108%' }}
                animate={{ y: 0 }}
                transition={{ delay: 0.12, duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
              >
                五个工具，
              </motion.span>
            </span>
            <span className="block overflow-hidden pb-[0.08em]">
              <motion.span
                className="block"
                initial={reduceMotion ? false : { y: '108%' }}
                animate={{ y: 0 }}
                transition={{ delay: 0.22, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              >
                一个页面。
              </motion.span>
            </span>
          </motion.h1>

          <motion.span
            aria-hidden="true"
            initial={reduceMotion ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 1.02, duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
            className="mt-4 block h-[3px] w-16 origin-left rounded-full bg-[rgb(var(--copper))]/70"
          />
        </div>

        <motion.p
          data-slide-reveal="hero-copy"
          variants={enter}
          custom={2}
          initial="hidden"
          animate="show"
          className="mt-4 max-w-[46ch] text-[15.5px] leading-[1.9] text-muted text-pretty sm:mt-5"
        >
          写、画、剪、配音、排分镜，点一下切换。没接模型也能用，界面会标明是草稿。
        </motion.p>

        <motion.div
          data-slide-reveal="hero-actions"
          variants={enter}
          custom={3}
          initial="hidden"
          animate="show"
          className="mt-7 flex flex-wrap items-center gap-3 sm:mt-9"
        >
          <Button variant="primary" size="lg" onClick={onEnter}>
            进入工作台
            <ArrowRight size={16} strokeWidth={1.8} />
          </Button>
          <Button variant="ghost" size="lg" onClick={onBrowse} className="px-4">
            看看对话
          </Button>
        </motion.div>

        <motion.div
          data-slide-reveal="hero-stats"
          variants={enter}
          custom={4}
          initial="hidden"
          animate="show"
          className="mt-9 hidden flex-wrap items-center gap-x-7 gap-y-2 border-t border-[rgb(var(--line))]/70 pt-5 sm:flex md:mt-auto"
        >
          {[
            ['5', '工具'],
            ['2', '引擎：云 / 端'],
            ['1', '页面搞定'],
          ].map(([value, label]) => (
            <span key={label} className="flex items-baseline gap-2">
              <span className="font-mono text-[15px] tracking-wide text-ink">{value}</span>
              <span className="text-[11.5px] text-muted/80">{label}</span>
            </span>
          ))}
        </motion.div>
      </div>

      <motion.div
        variants={enter}
        custom={3}
        initial="hidden"
        animate="show"
        data-slide-reveal="hero-preview"
        className="md:col-span-6"
      >
        <div className={cn(STAGE_FRAME, 'md:col-span-6')}>
          <div className="grain relative flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/45 bg-white/30 p-3 backdrop-blur-xl">
          {/* Window chrome */}
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="flex items-center gap-1.5">
              {[0, 1, 2].map((dot) => (
                <span key={dot} className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--line))]" />
              ))}
            </span>
            <span className="ml-1 font-mono text-[9px] tracking-wide text-muted/75">
              loomscape / create
            </span>
          </div>

          {/* Tab strip: the whole point of the slide, five tools in one page */}
          <div className="mt-2 flex items-center gap-0.5 rounded-xl bg-[rgb(var(--paper))]/80 p-1.5">
            {TOOLS.map((tool, i) => {
              const Icon = tool.icon;
              return (
                <span
                  key={tool.key}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1 rounded-lg px-1 py-2',
                    i === 0
                      ? 'bg-white/90 text-ink shadow-[var(--shadow-neu-sm)]'
                      : 'text-ink/65',
                  )}
                >
                  <Icon size={13.5} strokeWidth={1.8} />
                  <span className="text-[10.5px] font-medium">{tool.name}</span>
                </span>
              );
            })}
          </div>

          {/* A real draft, not a skeleton: the tab strip says "five tools",
              the lines say "this is the text one" without any explanation. */}
          <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-xl border border-white/60 bg-white/45 p-4 backdrop-blur-md">
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] font-semibold text-ink">城市夜晚 · 提纲</span>
              <span className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-muted/70">
                draft
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {['街灯下的便利店', '末班地铁的车窗', '天台上的一层雾'].map((line, i) => (
                <li
                  key={line}
                  className="flex items-start gap-1.5 text-[11.5px] leading-snug text-ink/75"
                >
                  <span className="font-mono text-[8.5px] text-[rgb(var(--copper))]/70">
                    {i + 1}.
                  </span>
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-auto flex gap-1.5 pt-4">
              {['语气', '字数', '标题'].map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-white/50 bg-white/50 px-2 py-0.5 text-[9px] text-ink/65"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 px-2 pb-1 font-mono text-[9px] tracking-wide text-muted/80">
            <span>中断 + 重写 · 归档 · 记忆</span>
            <span className="shrink-0 text-muted/45">1,280 字 · 3 段</span>
          </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

const SOURCES = [
  { index: '1', name: '预算评审纪要', cited: true },
  { index: '2', name: '渠道复盘', cited: true },
  { index: '3', name: '行业季度报告', cited: false },
];

export function SlideCapabilities() {
  return (
    <div className="mx-auto grid h-full w-full max-w-[1400px] grid-cols-1 items-center gap-8 px-4 md:grid-cols-12 md:gap-10 md:px-8">
      <div data-slide-reveal="capability-intro" className={LEFT_COL}>
        <Eyebrow>02 · 对话</Eyebrow>
        <h2 className="mt-5 text-[clamp(2.2rem,3.6vw,3.1rem)] font-semibold leading-[1.2] text-ink">
          先查资料，
          <br />
          再回答。
        </h2>
        <p className="mt-6 max-w-[34ch] text-[14.5px] leading-[1.85] text-muted">
          问题先在你这台设备的资料里找依据；找不到就说没有，不编。答案带编号，能点回原文。
        </p>
        <div className="mt-auto flex items-center justify-between border-t border-[rgb(var(--line))]/65 pt-4 font-mono text-[9px] uppercase tracking-[0.16em] text-muted/55">
          <span>local retrieval</span>
          <span>18 ms · cited 2</span>
        </div>
      </div>

      <div
        data-slide-reveal="capability-answer"
        className={cn(STAGE_FRAME, 'md:col-span-6')}
      >
        <div className="grain relative flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/45 bg-white/30 p-3 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-muted/55">
            ask → retrieve → answer
          </span>
          <span className="rounded-full border border-white/55 bg-white/35 px-2 py-0.5 font-mono text-[9px] text-muted/65">
            取前 4 · 阈值内
          </span>
        </div>

        <div className="mt-3 rounded-xl border border-white/55 bg-white/52 px-3 py-2 text-[12.5px] text-ink/85 backdrop-blur-sm">
          预算砍了 30%，巡检方案怎么调？
        </div>

        <div className="mt-2 flex items-center gap-2 pl-3">
          <span className="h-2.5 w-px bg-[rgb(var(--line))]" />
          <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-muted/45">
            retrieve
          </span>
        </div>

        <div className="mt-1 flex items-center justify-center gap-2 rounded-xl border border-white/50 bg-white/45 px-3 py-2.5 backdrop-blur-sm">
          <span className="font-mono text-[11.5px] text-muted/75">资料 8 段</span>
          <ArrowRight size={13} className="text-muted/45" />
          <span className="font-mono text-[11.5px] font-medium text-[rgb(var(--accent))]">
            命中 3
          </span>
          <ArrowRight size={13} className="text-muted/45" />
          <span className="font-mono text-[11.5px] text-ink/75">引用 2</span>
        </div>

        <div className="mt-1 flex items-center gap-2 pl-3">
          <span className="h-2.5 w-px bg-[rgb(var(--line))]" />
          <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-muted/45">
            answer
          </span>
        </div>

        <div className="mt-1 rounded-xl border border-white/55 bg-white/52 px-3 py-2.5 text-[12.5px] leading-[1.85] text-ink/85 backdrop-blur-sm">
          先砍非核心点位，保住高频巡检
          <sup className="ml-0.5 font-mono text-[9px] text-[rgb(var(--copper))]">[1]</sup>
          ；私域改分层，低频客户合并批次
          <sup className="ml-0.5 font-mono text-[9px] text-[rgb(var(--copper))]">[2]</sup>。
        </div>

        <div className="mt-2.5 space-y-1">
          {SOURCES.map((source) => (
            <div
              key={source.index}
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-1.5',
                source.cited ? 'bg-white/45' : 'bg-transparent opacity-40',
              )}
            >
              <span className="font-mono text-[9px] text-[rgb(var(--copper))]">
                [{source.index}]
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink/75">
                {source.name}
              </span>
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  source.cited ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--line))]',
                )}
              />
            </div>
          ))}
        </div>
        <div className="mt-auto flex items-center justify-between border-t border-[rgb(var(--line))]/60 pt-3 font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted/45">
          <span>local retrieval</span>
          <span>0 network calls</span>
        </div>
        </div>
      </div>
    </div>
  );
}

const LAYERS = [
  {
    icon: Monitor,
    name: '浏览器',
    detail: '数据 + 模型',
    tags: ['9 store', '权重缓存'],
    active: true,
  },
  { icon: Server, name: '服务端', detail: '只转发 · 不落盘', tags: ['无用户表'], active: false },
  { icon: Cloud, name: '云端 API', detail: '你要接才接', tags: ['可选'], active: false },
];

export function SlideProcess() {
  return (
    <div className="mx-auto grid h-full w-full max-w-[1400px] grid-cols-1 items-center gap-8 px-4 md:grid-cols-12 md:gap-10 md:px-8">
      <div data-slide-reveal="process-intro" className={LEFT_COL}>
        <Eyebrow>03 · 底座</Eyebrow>
        <h2 className="mt-5 text-[clamp(2.2rem,3.6vw,3.1rem)] font-semibold leading-[1.2] text-ink">
          数据只在
          <br />
          浏览器里。
        </h2>
        <p className="mt-6 max-w-[34ch] text-[14.5px] leading-[1.85] text-muted">
          账户、作品、密钥、模型都存在本机；服务端只转发请求，不存你的东西。断网也能写。
        </p>
        <div className="mt-6 flex flex-wrap gap-1.5">
          {['local-first', '9 store', '断网可用'].map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/55 bg-white/30 px-2.5 py-1 font-mono text-[10px] text-muted backdrop-blur-md"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="mt-auto flex items-center justify-between border-t border-[rgb(var(--line))]/65 pt-4 font-mono text-[9px] uppercase tracking-[0.16em] text-muted/55">
          <span>0 uploads</span>
          <span>browser only</span>
        </div>
      </div>

      <div
        data-slide-reveal="process-layers"
        className={cn(STAGE_FRAME, 'md:col-span-6')}
      >
        <div className="grain relative flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/45 bg-white/30 p-3 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-muted/55">
            where the data lives
          </span>
          <span className="rounded-full border border-white/55 bg-white/35 px-2 py-0.5 font-mono text-[9px] text-[rgb(var(--accent))]">
            0 上传
          </span>
        </div>

        <div className="mt-3">
          {LAYERS.map((layer, i) => {
            const Icon = layer.icon;
            return (
              <div key={layer.name}>
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-xl border px-3.5 py-2.5',
                    layer.active
                      ? 'border-white/75 bg-white/72 shadow-[var(--shadow-neu-sm)] backdrop-blur-sm'
                      : 'border-white/50 bg-white/45 backdrop-blur-sm',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/70',
                      layer.active ? 'bg-white/70 text-[rgb(var(--accent))]' : 'bg-white/35 text-muted/70',
                    )}
                  >
                    <Icon size={14} strokeWidth={1.7} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold leading-tight text-ink">
                      {layer.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-[9.5px] tracking-wide text-muted/70">
                      {layer.detail}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {layer.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-white/60 bg-white/45 px-1.5 py-0.5 font-mono text-[8.5px] text-muted/70"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                </div>
                {i < LAYERS.length - 1 ? (
                  <div className="flex justify-center py-1">
                    <span className="h-3 w-px bg-[rgb(var(--line))]" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[rgb(var(--line))]/60 pt-3">
          {[
            ['9', '本地 store'],
            ['3', '档调度'],
            ['0', '服务端用户表'],
          ].map(([value, label]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <span className="font-mono text-[14px] text-ink">{value}</span>
              <span className="text-[10.5px] leading-tight text-muted/80">{label}</span>
            </div>
          ))}
        </div>
        <div className="mt-auto flex items-center justify-between border-t border-[rgb(var(--line))]/60 pt-3 font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted/45">
          <span>local session</span>
          <span>no upload</span>
        </div>
        </div>
      </div>
    </div>
  );
}

const POINTS = ['看得见', '点得准', '停得住', '不断网'];

export function SlideAbout({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="mx-auto grid h-full w-full max-w-[1400px] grid-cols-1 content-center gap-8 px-4 md:grid-cols-12 md:gap-10 md:px-8">
      <div className={LEFT_COL}>
        <div data-slide-reveal="about-copy">
          <Eyebrow>04 · 光标</Eyebrow>
          <h2 className="mt-6 text-[clamp(2.3rem,3.9vw,3.5rem)] font-semibold leading-[1.2] text-ink text-balance">
            直接点，
            <br />
            不只是说。
          </h2>
          <p className="mt-7 max-w-[50ch] text-[14px] leading-[1.9] text-muted text-pretty">
            说一句，光标找到按钮、点下去、填进去。危险操作先问你，Esc 随时接管。
          </p>
        </div>

        <div data-slide-reveal="about-stats" className="mt-7 flex flex-wrap gap-1.5">
          {POINTS.map((point) => (
            <span
              key={point}
              className="rounded-full border border-white/55 bg-white/35 px-3 py-1.5 text-[11.5px] text-ink/75 backdrop-blur-md"
            >
              {point}
            </span>
          ))}
        </div>

        <div data-slide-reveal="about-actions" className="mt-8 flex flex-wrap items-center gap-3 md:mt-auto md:pt-8">
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

      <div data-slide-reveal="about-system" className="hidden md:col-span-6 md:block">
        <SlideStage className="p-4">
          <HomePreview />
          <p className="mt-auto pl-1 pt-3 font-mono text-[9.5px] tracking-wide text-muted/50">
            看见 → 找到 → 确认
          </p>
        </SlideStage>
      </div>
    </div>
  );
}
