'use client';

import { useState } from 'react';
import {
  ArrowRight,
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
import { Mark } from '@/components/brand';

/**
 * Slide order matches the nav: 创作 → 对话 → 底座 → 光标.
 *
 * Editorial rule for the four tour spreads: one claim on the left, one working
 * demo on the right. The copy only names what the demo cannot show by itself —
 * no paragraphs, no bullet lists, no feature inventory. If a line can be
 * replaced by the stage doing it, the line goes.
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

/**
 * The claim column is narrow on purpose: a 380px track and a 1fr stage, centred
 * as a pair. The stage is the pitch; the words are its title.
 */
const STAGE_H = 'md:min-h-[clamp(460px,58vh,620px)]';
const LEFT_COL = 'md:flex md:flex-col md:justify-center';
const SHELL =
  'relative mx-auto grid h-full w-full max-w-[1200px] content-center grid-cols-1 gap-10 px-4 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)] md:gap-16 md:px-0';
const STAGE_FRAME = cn(
  'intro-stage grain relative flex w-full flex-col justify-start overflow-hidden rounded-[34px] border border-white/75 bg-[#f7f3fb]/96 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_30px_70px_-46px_rgba(61,54,72,0.42)] backdrop-blur-2xl',
  STAGE_H,
);

const TOOLS = [
  { key: 'text', name: '文本', icon: FileText, active: true },
  { key: 'image', name: '图像', icon: ImageIcon, active: false },
  { key: 'video', name: '影像', icon: Video, active: false },
  { key: 'voice', name: '声音', icon: AudioLines, active: false },
  { key: 'story', name: '故事', icon: BookOpen, active: false },
] as const;

const DRAFT_LINES = [
  '街灯下的便利店',
  '末班地铁的车窗',
  '天台上的一层雾',
  '便利店门口的对话',
  '清晨第一班车',
];

/** Text: the draft itself, so "five tools" is shown by what a tool produces. */
function TextPane() {
  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-ink">城市夜晚 · 提纲</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted/70">
          draft
        </span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {DRAFT_LINES.map((line, i) => (
          <li key={line} className="flex items-start gap-1.5 text-[12px] leading-snug text-ink/75">
            <span className="font-mono text-[8.5px] text-[rgb(var(--copper))]/70">{i + 1}.</span>
            {line}
          </li>
        ))}
      </ul>
      <p className="mt-3 max-w-[48ch] text-[11.5px] leading-[1.9] text-ink/55">
        夜里十一点半，便利店的灯还亮着。玻璃门上的雾气被手指擦出一个小口子，露出里面横着的两排饮料。
        收银台后面的人在看手机，屏幕的光把他的下巴照成蓝色。
      </p>
      <div className="mt-auto flex gap-1.5 pt-4">
        {['语气', '字数', '标题'].map((chip) => (
          <span
            key={chip}
            className="rounded-full border border-white/50 bg-white/50 px-2 py-0.5 text-[9.5px] text-ink/65"
          >
            {chip}
          </span>
        ))}
      </div>
    </>
  );
}

export function SlideHero() {
  const reduceMotion = useReducedMotion();

  return (
    <div className={SHELL}>
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
            className="mt-5 max-w-[9ch] text-[clamp(2.7rem,4.6vw,4.4rem)] font-semibold leading-[1.12] tracking-[0.005em] text-ink text-balance sm:mt-6"
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
            className="mt-5 block h-[3px] w-16 origin-left rounded-full bg-[rgb(var(--copper))]/70"
          />
        </div>
      </div>

      <motion.div
        variants={enter}
        custom={3}
        initial="hidden"
        animate="show"
        data-slide-reveal="hero-preview"
      >
        <div className={STAGE_FRAME}>
          <div className="grain relative flex min-h-0 flex-1 flex-col overflow-hidden p-1">
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

            <div className="mt-2 flex items-center gap-0.5 rounded-xl border border-white/50 bg-[rgb(var(--ink))]/[0.055] p-1.5 backdrop-blur-sm">
              {TOOLS.map((item) => {
                const Icon = item.icon;
                return (
                  <span
                    key={item.key}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-1 py-2',
                      item.active
                        ? 'bg-white/92 text-ink shadow-[var(--shadow-neu-sm)] backdrop-blur-sm'
                        : 'text-ink/55',
                    )}
                  >
                    <Icon size={14} strokeWidth={1.8} />
                    <span className="text-[11px] font-medium">{item.name}</span>
                  </span>
                );
              })}
            </div>

            <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-xl p-4">
              <TextPane />
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 px-2 pb-1 font-mono text-[9px] tracking-wide text-muted/80">
              <span className="uppercase tracking-[0.18em] text-muted/55">text</span>
              <span className="shrink-0 text-muted/45">1,280 字 · 3 段</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

const SOURCES = [
  {
    index: 1,
    name: '预算评审纪要',
    snippet: '核心点位维持高频巡检，非核心点位可降频或合并…',
    cited: true,
  },
  {
    index: 2,
    name: '渠道复盘',
    snippet: '私域分层后低频客户合并批次，成本下降 18%。',
    cited: true,
  },
  { index: 3, name: '行业季度报告', snippet: '行业平均巡检频次 1.8 次/月。', cited: false },
];

/**
 * Hover or focus a source and the matching [n] in the answer lights up. The
 * link between citation and source is shown, not described.
 */
export function SlideCapabilities() {
  const [active, setActive] = useState<number | null>(null);

  return (
    <div className={SHELL}>
      <div data-slide-reveal="capability-intro" className={LEFT_COL}>
        <Eyebrow>02 · 对话</Eyebrow>
        <h2 className="mt-5 text-[clamp(2.3rem,4vw,3.4rem)] font-semibold leading-[1.18] text-ink">
          先查资料，
          <br />
          再回答。
        </h2>
      </div>

      <div data-slide-reveal="capability-answer" className={STAGE_FRAME}>
        <div className="grain relative flex min-h-0 flex-1 flex-col overflow-hidden p-1">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="flex items-center gap-1.5">
              {[0, 1, 2].map((dot) => (
                <span key={dot} className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--line))]" />
              ))}
            </span>
            <span className="ml-1 font-mono text-[9px] tracking-wide text-muted/75">
              loomscape / chat
            </span>
          </div>

          <div className="mt-1 px-1 py-2 text-[13px] text-ink/85">
            预算砍了 30%，巡检方案怎么调？
          </div>

          <div className="mt-3 flex items-center gap-2 pl-3">
            <span className="h-2.5 w-px bg-[rgb(var(--line))]" />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-muted/45">
              retrieve
            </span>
          </div>

          <div className="mt-1 flex items-center justify-center gap-2 px-1 py-3">
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

          <div className="mt-1 px-1 py-3 text-[13px] leading-[1.9] text-ink/85">
            先砍非核心点位，保住高频巡检
            <sup
              className={cn(
                'ml-0.5 rounded px-0.5 font-mono text-[9.5px] transition-colors duration-150',
                active === 1
                  ? 'bg-[rgb(var(--copper))]/20 text-[rgb(var(--copper))]'
                  : 'text-[rgb(var(--copper))]/75',
              )}
            >
              [1]
            </sup>
            ；私域改分层，低频客户合并批次
            <sup
              className={cn(
                'ml-0.5 rounded px-0.5 font-mono text-[9.5px] transition-colors duration-150',
                active === 2
                  ? 'bg-[rgb(var(--copper))]/20 text-[rgb(var(--copper))]'
                  : 'text-[rgb(var(--copper))]/75',
              )}
            >
              [2]
            </sup>
            。
          </div>

          <div className="mt-3 flex flex-1 flex-col justify-center gap-1">
            {SOURCES.map((source) => (
              <button
                key={source.index}
                type="button"
                onMouseEnter={() => setActive(source.index)}
                onFocus={() => setActive(source.index)}
                onMouseLeave={() => setActive(null)}
                onBlur={() => setActive(null)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-all duration-150',
                  source.cited ? 'bg-white/45' : 'opacity-40',
                  active === source.index &&
                    'bg-white/85 opacity-100 ring-1 ring-[rgb(var(--copper))]/35',
                )}
              >
                <span className="font-mono text-[9px] text-[rgb(var(--copper))]">
                  [{source.index}]
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-ink/80">
                    {source.name}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[9.5px] leading-relaxed text-muted/65">
                    {source.snippet}
                  </span>
                </span>
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    source.cited ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--line))]',
                  )}
                />
              </button>
            ))}
          </div>

          <div className="mt-auto border-t border-[rgb(var(--line))]/60 pt-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                ['2', '条被引用'],
                ['1', '条没引用'],
                ['1,204', '段资料库'],
              ].map(([value, label]) => (
                <div key={label} className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[14px] text-ink">{value}</span>
                  <span className="text-[10.5px] leading-tight text-muted/80">{label}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted/45">
              <span>local retrieval</span>
              <span>0 network calls</span>
            </div>
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
  const reduceMotion = useReducedMotion();

  return (
    <div className={SHELL}>
      <div data-slide-reveal="process-intro" className={LEFT_COL}>
        <Eyebrow>03 · 底座</Eyebrow>
        <h2 className="mt-5 text-[clamp(2.3rem,4vw,3.4rem)] font-semibold leading-[1.18] text-ink">
          数据只在
          <br />
          浏览器里。
        </h2>
      </div>

      <div data-slide-reveal="process-layers" className={STAGE_FRAME}>
        <div className="grain relative flex min-h-0 flex-1 flex-col overflow-hidden p-1">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="flex items-center gap-1.5">
              {[0, 1, 2].map((dot) => (
                <span key={dot} className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--line))]" />
              ))}
            </span>
            <span className="ml-1 font-mono text-[9px] tracking-wide text-muted/75">
              loomscape / studio
            </span>
          </div>

          <div className="mt-1 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-muted/55">
              where the data lives
            </span>
            <span className="rounded-full border border-white/55 bg-white/35 px-2 py-0.5 font-mono text-[9px] text-[rgb(var(--accent))]">
              0 上传
            </span>
          </div>

          <div className="mt-3 flex flex-1 flex-col justify-center">
            {LAYERS.map((layer, i) => {
              const Icon = layer.icon;
              return (
                <div key={layer.name}>
                  <div
                    className={cn(
                      'relative flex items-center gap-3 rounded-xl border px-3.5 py-2.5',
                      layer.active
                        ? 'border-white/75 bg-white/72 shadow-[var(--shadow-neu-sm)] backdrop-blur-sm'
                        : 'border-white/50 bg-white/45 backdrop-blur-sm',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/70',
                        layer.active
                          ? 'bg-white/70 text-[rgb(var(--accent))]'
                          : 'bg-white/35 text-muted/70',
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

                    {/* The packet tries to leave the browser box and is turned
                        back at the edge: "0 上传" shown instead of written. */}
                    {layer.active ? (
                      <motion.span
                        aria-hidden="true"
                        className="pointer-events-none absolute right-2 top-1/2 h-1.5 w-1.5 rounded-full bg-[rgb(var(--copper))]"
                        animate={
                          reduceMotion
                            ? undefined
                            : { x: [0, 22, 22, 0], opacity: [0, 1, 1, 0] }
                        }
                        transition={{ duration: 3.4, times: [0, 0.35, 0.55, 1], repeat: Infinity, ease: 'easeInOut' }}
                      />
                    ) : null}
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

          <div className="mt-3 rounded-lg border border-white/60 bg-white/40 px-3 py-2">
            <div className="flex items-center justify-between font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted/55">
              <span>local storage</span>
              <span>72 KB / 10 GB</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[rgb(var(--ink))]/[0.08]">
              <div className="h-full w-[3%] rounded-full bg-[rgb(var(--accent))]/60" />
            </div>
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

export function SlideAbout() {
  return (
    <div className={SHELL}>
      <div className={LEFT_COL}>
        <div data-slide-reveal="about-copy">
          <Eyebrow>04 · 光标</Eyebrow>
          <h2 className="mt-6 text-[clamp(2.4rem,4.2vw,3.7rem)] font-semibold leading-[1.18] text-ink text-balance">
            直接点，
            <br />
            不只是说。
          </h2>
        </div>
      </div>

      <div data-slide-reveal="about-system" className={STAGE_FRAME}>
        <div className="grain relative flex min-h-0 flex-1 flex-col overflow-hidden p-1">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="flex items-center gap-1.5">
              {[0, 1, 2].map((dot) => (
                <span key={dot} className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--line))]" />
              ))}
            </span>
            <span className="ml-1 font-mono text-[9px] tracking-wide text-muted/75">
              loomscape.site / brief
            </span>
          </div>

          <div className="mt-2 flex min-h-0 flex-1 flex-col rounded-xl p-4">
            <HomePreview />
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 px-2 pb-1 font-mono text-[9px] tracking-wide text-muted/80">
            <span className="uppercase tracking-[0.18em] text-muted/55">cursor</span>
            <span className="shrink-0 text-muted/45">one task at a time</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Cover screen. It answers "what is this" before the tour explains how it
 * works: brand, one sentence of positioning, and the two ways forward.
 */
export function SlideCover({ onEnter, onLearn }: { onEnter: () => void; onLearn: () => void }) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      data-cover=""
      className="relative mx-auto flex h-full w-full max-w-[1400px] flex-col items-center justify-center px-4 text-center md:px-8"
    >
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center"
      >
        <Mark className="h-12 w-12 text-ink md:h-14 md:w-14" />

        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.32em] text-muted/70">
          local-first · multimodal studio
        </p>

        <h1
          aria-label="织境 Loomscape"
          className="mt-4 flex items-baseline justify-center gap-[0.18em] font-serif text-[clamp(2.6rem,5.4vw,4.6rem)] leading-[1.08] tracking-tight"
        >
          <span className="text-[0.66em] tracking-tight text-[rgb(var(--accent))] opacity-95">Loom</span>
          <span className="text-ink">织境</span>
          <span className="text-[0.66em] tracking-tight text-[rgb(var(--accent))] opacity-95">scape</span>
        </h1>

        <p className="mt-5 max-w-[46ch] text-[15px] leading-[1.9] text-muted text-pretty">
          以 AI 对话为主体，文本、图像、影像、声音、故事五种材料在同一条时间线上，
          随时切换、互相引用。
        </p>
        <p className="mt-2 max-w-[44ch] text-[12.5px] leading-relaxed text-muted/75">
          数据只留在本机浏览器；没接模型时界面会标明是草稿，不假装已经生成。
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button variant="primary" size="lg" onClick={onEnter}>
            进入工作台
            <ArrowRight size={16} strokeWidth={1.8} />
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={onLearn}
            className="border border-[rgb(var(--ink))]/15 px-5 hover:bg-white/60"
          >
            了解详情
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
