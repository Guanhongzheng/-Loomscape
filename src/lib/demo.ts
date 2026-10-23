'use client';

import { mulberry32, seedFrom } from './id';

export type Tone = '克制' | '明亮' | '锋利';

export type DraftSection = { title: string; body: string };

export type Draft = {
  headline: string;
  sections: DraftSection[];
  variants: string[];
  offline: true;
};

const INSTRUCTION = /^(请|帮我|给我|麻烦|我想|我要|需要|写|做|生成|创作|来|把|用|为|给|关于|围绕|针对)+/;

/**
 * Pulls a short subject out of a brief. People usually write "为 X 写一段 Y，
 * 语气 Z"; the studio only needs X to label the draft.
 */
export function subjectOf(brief: string): string {
  const clause = brief.replace(/\s+/g, ' ').split(/[，。；,;!?！？]/)[0] ?? '';
  let subject = clause.replace(INSTRUCTION, '');
  subject = subject.replace(/(写|做|生成|创作|拟|出)(一|两|三|几)?(段|篇|版|条|个|支)?/g, '');
  subject = subject.replace(/(短文案|文案稿|文案|预告|脚本|旁白|分镜|标题|说明)/g, '');
  subject = subject.replace(/^(一|这|那)(家|个|位|本|间|座)/, '$1$2');
  subject = subject.replace(/[\s，。、；：:!?！？]/g, '');
  const trimmed = subject.slice(0, 12);
  return trimmed || brief.trim().slice(0, 10) || '未命名主题';
}

/** Short noun used inline, e.g. 旧书店 from 一家只在夜里营业的旧书店. */
function pivotOf(subject: string): string {
  const parts = subject.split('的').filter(Boolean);
  const tail = parts[parts.length - 1] ?? subject;
  return tail.length >= 2 ? tail.slice(0, 8) : subject.slice(0, 6);
}

const MOVES: Array<(subject: string) => DraftSection> = [
  (subject) => ({
    title: '开场',
    body: `不要解释「${subject}」。从一个可以测量的细节开始：光落在哪个面上、门轴响了几次、空气里有什么味道。读者先进入空间，再接受信息。`,
  }),
  (subject) => ({
    title: '支点',
    body: '把最具体的那个名词放到句末。中文的句末是重力所在，最后两个字决定整段话的重心，前面所有的铺垫都为它让路。',
  }),
  () => ({
    title: '留白',
    body: '删掉三分之一。最容易被写坏的是情绪形容词，把它们换成动作：推开、停顿、把手收回。读者的身体会替你补完情绪。',
  }),
  (subject) => ({
    title: '节奏断点',
    body: `在第二段中间放一次停顿：一个短句，一次换行。节奏的变化比辞藻更能标记重点，${subject} 的分量靠这个断点撑起来。`,
  }),
  () => ({
    title: '视角',
    body: '把镜头交给一个不该看见这件事的人。同一件事从他的角度被看见时，会多出一层不必解释的意味。',
  }),
  (subject) => ({
    title: '物的位置',
    body: `让一件与 ${subject} 有关的小物出现三次，每次改变它的状态。第三次出现时，不需要任何说明，读者已经知道发生了什么。`,
  }),
];

const VARIANTS = {
  克制: (subject: string) => [
    `把「${subject}」放在句子后半段，前半段留一个空房间。`,
    `不要说服，只描述。让「${subject}」自己暴露重量。`,
    `用最少的动词，让「${subject}」只发生一次。`,
  ],
  明亮: (subject: string) => [
    `让「${subject}」先有颜色，再有意义。`,
    `把它写成一件正在发生的好事，别急着收尾。`,
    `「${subject}」需要一个具体的下午，光从左边进来。`,
  ],
  锋利: (subject: string) => [
    `「${subject}」不需要解释，它需要一个切口。`,
    `别写「${subject}」，写它留下的痕迹。`,
    `把代价写出来，其余的部分读者会自己完成。`,
  ],
} as const;

/**
 * Offline drafting. This is deliberately an outline rather than fabricated
 * prose: without a connected model the studio offers structure and craft
 * moves instead of pretending to have written something for you.
 */
export function offlineDraft(brief: string, tone: Tone = '克制'): Draft {
  const subject = subjectOf(brief);
  const pivot = pivotOf(subject);
  const rand = mulberry32(seedFrom(brief + tone));

  const pool = [...MOVES];
  const picked: DraftSection[] = [];
  for (let i = 0; i < 2 && pool.length; i += 1) {
    const index = Math.floor(rand() * pool.length);
    const move = pool.splice(index, 1)[0];
    picked.push(move(i === 0 ? subject : pivot));
  }

  const headlines: Record<Tone, string> = {
    克制: `围绕「${subject}」的一次起草。`,
    明亮: `让「${subject}」先亮起来，再被记住。`,
    锋利: `「${subject}」不需要解释，它需要一个切口。`,
  };

  return {
    headline: headlines[tone],
    sections: [
      {
        title: '一句话',
        body: `用一句不超过二十字的陈述句交代「${subject}」，不修饰、不转折。这句话是骨架，删掉它之后剩下的部分都应该失去意义。`,
      },
      picked[0],
      picked[1],
      {
        title: '收尾',
        body: '回到开头那个细节，让它变化一度。不要总结，不要升华，把最后一行留给一个动作或一个物件。',
      },
    ].filter(Boolean) as DraftSection[],
    variants: VARIANTS[tone](subject),
    offline: true,
  };
}

export function draftToText(draft: Draft): string {
  return [
    draft.headline,
    '',
    ...draft.sections.flatMap((section) => [`## ${section.title}`, section.body, '']),
    '## 语气备选',
    ...draft.variants.map((line, i) => `${i + 1}. ${line}`),
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/* Offline artwork                                                            */
/* -------------------------------------------------------------------------- */

function hsl(h: number, s: number, l: number, alpha = 1): string {
  return `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${alpha})`;
}

/**
 * Deterministic composition built from the prompt. Uses the same restrained
 * palette as the interface so saved pieces still look like part of the studio.
 */
export function renderOfflineArtwork(prompt: string, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const rand = mulberry32(seedFrom(prompt || 'loomscape'));
  const hue = Math.floor(rand() * 360);
  const w = width;
  const h = height;

  const wash = ctx.createLinearGradient(0, 0, w * 0.9, h);
  wash.addColorStop(0, hsl(hue, 16, 95));
  wash.addColorStop(0.55, hsl(hue + 24, 20, 90));
  wash.addColorStop(1, hsl(hue + 48, 22, 84));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(w * 0.24, h * 0.2, 0, w * 0.24, h * 0.2, Math.max(w, h) * 0.7);
  glow.addColorStop(0, 'rgba(255,255,255,0.85)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const bands = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < bands; i += 1) {
    const y0 = h * (0.12 + rand() * 0.78);
    const y1 = h * (0.12 + rand() * 0.78);
    const depth = rand();
    const color =
      depth > 0.82
        ? hsl(hue + 180 + rand() * 30, 34, 46, 0.16 + rand() * 0.12)
        : hsl(hue + rand() * 40, 24 + rand() * 14, 34 + rand() * 34, 0.12 + rand() * 0.2);

    ctx.beginPath();
    ctx.moveTo(-w * 0.1, y0);
    ctx.bezierCurveTo(
      w * 0.28,
      h * (rand() * 0.3 + 0.05),
      w * 0.62,
      h * (rand() * 0.55 + 0.25),
      w * 1.1,
      y1,
    );
    ctx.lineWidth = 8 + rand() * (Math.min(w, h) * 0.14);
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 26;
    ctx.stroke();
  }

  ctx.shadowBlur = 0;

  for (let i = 0; i < 26; i += 1) {
    const y0 = h * rand();
    ctx.beginPath();
    ctx.moveTo(-20, y0);
    ctx.bezierCurveTo(w * 0.32, h * rand(), w * 0.66, h * rand(), w + 20, h * rand());
    ctx.lineWidth = rand() > 0.86 ? 1.4 : 0.6;
    ctx.strokeStyle = hsl(hue + 6, 30, 26, 0.1 + rand() * 0.18);
    ctx.stroke();
  }

  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.78);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(24,30,42,0.14)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  const noise = document.createElement('canvas');
  noise.width = 96;
  noise.height = 96;
  const nctx = noise.getContext('2d');
  if (nctx) {
    const data = nctx.createImageData(96, 96);
    for (let i = 0; i < data.data.length; i += 4) {
      const value = 120 + Math.random() * 135;
      data.data[i] = value;
      data.data[i + 1] = value;
      data.data[i + 2] = value;
      data.data[i + 3] = 16;
    }
    nctx.putImageData(data, 0, 0);
    const pattern = ctx.createPattern(noise, 'repeat');
    if (pattern) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  const inset = Math.round(Math.min(w, h) * 0.045);
  ctx.strokeStyle = hsl(hue + 10, 26, 24, 0.16);
  ctx.lineWidth = 1;
  ctx.strokeRect(inset + 0.5, inset + 0.5, w - inset * 2 - 1, h - inset * 2 - 1);

  return canvas.toDataURL('image/png');
}
