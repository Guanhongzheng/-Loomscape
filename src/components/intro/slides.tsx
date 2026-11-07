'use client';

import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Eye,
  ListTree,
  Minus,
  MousePointer2,
  ShieldCheck,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { HomePreview } from './home-preview';

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

export function SlideHero({ onEnter, onBrowse }: { onEnter: () => void; onBrowse: () => void }) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative mx-auto grid h-full w-full max-w-[1280px] grid-cols-1 items-center gap-6 px-5 md:grid-cols-12 md:gap-10 md:px-8">
      <div className="md:col-span-7">
        <div data-slide-reveal="hero-heading">
          <motion.div
            variants={enter}
            custom={0}
            initial="hidden"
            animate="show"
            className="hidden sm:block"
          >
            <Eyebrow>Browser AI cursor · 织境</Eyebrow>
          </motion.div>

          <motion.h1
            variants={enter}
            custom={1}
            initial="hidden"
            animate="show"
            className="mt-4 max-w-[15ch] text-[clamp(2.7rem,4.5vw,4.5rem)] font-semibold leading-[1.16] tracking-[0.005em] text-ink text-balance sm:mt-6"          >
            <span className="block overflow-hidden pb-[0.08em]">
              <motion.span
                className="block"
                initial={reduceMotion ? false : { y: '108%' }}
                animate={{ y: 0 }}
                transition={{ delay: 0.12, duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
              >
                让 AI 光标，
              </motion.span>
            </span>
            <span className="block overflow-hidden pb-[0.08em]">
              <motion.span
                className="block"
                initial={reduceMotion ? false : { y: '108%' }}
                animate={{ y: 0 }}
                transition={{ delay: 0.22, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              >
                替你操作浏览器。
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
          className="mt-4 max-w-[46ch] text-[15px] leading-[1.9] text-muted text-pretty sm:mt-5"
        >
          <span className="sm:hidden">一个看得见、可暂停的浏览器 AI 光标。</span>
          <span className="hidden sm:inline">
            它看得懂当前页面，会找到按钮、填写表单、滚动页面。每一步都看得见；危险动作先停下，你随时可以接管。
          </span>
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
            看看它能做什么
          </Button>
        </motion.div>

        <motion.div
          data-slide-reveal="hero-stats"
          variants={enter}
          custom={4}
          initial="hidden"
          animate="show"
          className="mt-9 hidden flex-wrap items-center gap-x-7 gap-y-2 border-t border-[rgb(var(--line))]/70 pt-5 sm:flex"
        >
          {[
            ['01', '当前页'],
            ['00', '后台自动操作'],
            ['100%', '可随时接管'],
          ].map(([value, label]) => (
            <span key={label} className="flex items-baseline gap-2">
              <span className="font-mono text-[12px] tracking-wide text-ink">{value}</span>
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
        className="md:col-span-5"
      >
        <HomePreview />
      </motion.div>
    </div>
  );
}

const CAPABILITIES = [
  {
    index: '01',
    name: '看页面',
    tagline: '先把当前页读成一张地图',
    detail: '可访问名称 · 元素角色 · 视口位置 · 开放 Shadow DOM',
    icon: Eye,
  },
  {
    index: '02',
    name: '点得准',
    tagline: '光标落在真实控件上',
    detail: '点击 · 输入 · 滚动 · 高亮 · 离屏元素自动滚入',
    icon: MousePointer2,
  },
  {
    index: '03',
    name: '会拆任务',
    tagline: '一句话变成一串动作',
    detail: '本地队列 · 模型规划（后续） · 最多六步 · 逐步显示',
    icon: ListTree,
  },
  {
    index: '04',
    name: '随时停',
    tagline: '危险动作不抢跑',
    detail: '提交前确认 · 失败即停 · 人工接管 · 密码不填',
    icon: ShieldCheck,
  },
];

export function SlideCapabilities() {
  return (
    <div className="mx-auto grid h-full w-full max-w-[1280px] grid-cols-1 items-center gap-10 px-5 md:grid-cols-12 md:px-8">
      <div data-slide-reveal="capability-intro" className="md:col-span-5">
        <Eyebrow>Capability</Eyebrow>
        <h2 className="mt-5 text-[clamp(1.9rem,3vw,2.6rem)] font-semibold leading-[1.2] text-ink">
          一只光标，
          <br />
          四种本事。
        </h2>
        <p className="mt-6 max-w-[38ch] text-[14px] leading-[1.9] text-muted">
          它不只是会聊天：它要在当前页找到东西、点下去、填进去，并在做错之前停下来。
          所有动作都发生在你看得见的地方。
        </p>
        <div className="mt-6 flex flex-wrap gap-1.5">
          {['当前页', '可确认', '可接管'].map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/55 bg-white/30 px-2.5 py-1 text-[10.5px] text-muted backdrop-blur-md"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:col-span-7">
        {CAPABILITIES.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.index}
              data-slide-reveal={`capability-${item.index}`}
              className="neu-sm grain rounded-2xl p-5"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/50 bg-white/35 text-[rgb(var(--accent))] backdrop-blur-md">
                  <Icon size={15} strokeWidth={1.7} />
                </span>
                <span className="font-mono text-[9px] text-muted/50">{item.index}</span>
              </div>
              <h3 className="mt-5 text-[19px] font-semibold text-ink">{item.name}</h3>
              <p className="mt-1 text-[12.5px] text-ink/80">{item.tagline}</p>
              <p className="mt-2 font-mono text-[9px] leading-relaxed tracking-wide text-muted/65">
                {item.detail}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STEPS = [
  {
    index: '01',
    title: '看见',
    en: 'See',
    body: '先读当前页：哪些能点、哪些能填、它们在哪里。光标拿到的是一张可操作的页面地图，不是一堆猜出来的坐标。',
    points: ['可访问名称', '元素角色', '视口位置'],
  },
  {
    index: '02',
    title: '动手',
    en: 'Act',
    body: '光标移动到目标，点击、填写、滚动或高亮。动作按步骤发生，你能看见它正在做什么，也能在下一步之前叫停。',
    points: ['点击 / 输入', '滚动 / 高亮', '逐步执行'],
  },
  {
    index: '03',
    title: '确认',
    en: 'Verify',
    body: '提交、删除、发送之前先停下来问你。结果检查完再结束；你随时可以接管，或者让它在原地停住。',
    points: ['危险动作确认', '结果校验', '人工接管'],
  },
];

export function SlideProcess() {
  return (
    <div className="mx-auto flex h-full w-full max-w-[1280px] flex-col justify-center px-5 md:px-8">
      <Eyebrow>Workflow</Eyebrow>

      <div data-slide-reveal="process-intro" className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <h2 className="text-[clamp(1.9rem,3vw,2.6rem)] font-semibold leading-[1.2] text-ink">
          三步，让光标替你做。
        </h2>
        <p className="max-w-[38ch] text-[13px] leading-[1.9] text-muted">
          不是后台脚本，是你能看见的浏览器动作。停在任何一步，都可以重新来过。
        </p>
      </div>

      <div className="relative mt-14">
        <div className="absolute left-0 right-0 top-[9px] h-px bg-[rgb(var(--line))]" />
        <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.index}
              data-slide-reveal={`process-${i}`}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.08 * i, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="relative pl-1"
            >
              <span className="relative -top-[3px] block h-[7px] w-[7px] rounded-full bg-[rgb(var(--copper))] shadow-[0_0_0_4px_rgb(var(--paper))]" />
              <div className="mt-6 flex items-baseline gap-3">
                <span className="font-mono text-[10px] text-muted/60">{step.index}</span>
                <h3 className="font-semibold text-[26px] text-ink">{step.title}</h3>
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
    <div className="mx-auto grid h-full w-full max-w-[1280px] grid-cols-1 content-center gap-12 px-5 md:grid-cols-12 md:px-8">
      <div className="md:col-span-7">
        <div data-slide-reveal="about-copy">
          <Eyebrow>About</Eyebrow>
          <h2 className="mt-6 text-[clamp(2rem,3.4vw,3rem)] font-semibold leading-[1.2] text-ink text-balance">
            它看见页面，
            <br />
            但不带走页面。
          </h2>
          <p className="mt-7 max-w-[54ch] text-[14px] leading-[1.95] text-muted text-pretty">
            光标只在当前页工作。页面理解、动作执行和确认都留在浏览器里；默认不把页面交给远端模型。
            输入值、密码和页面 HTML 不上传。
          </p>
        </div>

        <div data-slide-reveal="about-stats" className="mt-10 grid grid-cols-3 gap-4 md:max-w-[26rem]">
          {[
            { value: '0', label: '后台自动操作' },
            { value: '100%', label: '可随时接管' },
            { value: '0', label: '上传的输入值' },
          ].map((item) => (
            <div key={item.label}>
              <div className="font-semibold text-[30px] leading-none text-ink">{item.value}</div>
              <div className="mt-2 text-[11px] leading-relaxed text-muted/80">{item.label}</div>
            </div>
          ))}
        </div>

        <div data-slide-reveal="about-actions" className="mt-11 flex flex-wrap items-center gap-3">
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

      <div data-slide-reveal="about-system" className="hidden md:col-span-5 md:block md:pl-6">
        <div className="neu-inset grain rounded-[26px] p-7">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted/80">
            System
          </div>
          <dl className="mt-5 space-y-4">
            {[
              ['光标', 'Content script · 可见覆盖层'],
              ['规划', '本地队列 · 模型后续'],
              ['安全', '提交前确认 · 密码不填'],
              ['接管', 'Esc · 停止 · 人工优先'],
              ['边界', '当前页 · 顶层 · 不后台'],
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
