'use client';

import Link from 'next/link';
import { Sparkle } from 'lucide-react';
import { Panel } from '@/components/studio/workbench';
import type { EmbedderInfo } from '@/lib/memory';

/**
 * A read-only explanation of the retrieval chain, plus whichever embedder is
 * actually in use. It is static on purpose: the numbers move with the index,
 * the steps do not, so there is nothing here to keep in state.
 */
export function RetrievalPanel({ embedder }: { embedder: EmbedderInfo | null }) {
  return (
    <Panel title="检索链路" hint="当前实际使用的嵌入方式">
      <ol className="space-y-2.5 text-[12px] leading-relaxed text-muted">
        <li className="flex gap-2">
          <span className="font-mono text-[10.5px] text-[rgb(var(--copper))]/85">01</span>
          <span>提问先嵌入，与本地片段计算余弦相似度。</span>
        </li>
        <li className="flex gap-2">
          <span className="font-mono text-[10.5px] text-[rgb(var(--copper))]/85">02</span>
          <span>取前 4 条，拼成带编号的上下文。</span>
        </li>
        <li className="flex gap-2">
          <span className="font-mono text-[10.5px] text-[rgb(var(--copper))]/85">03</span>
          <span>回答里的 [n] 与来源列表一一对应。</span>
        </li>
      </ol>
      <div className="mt-4 flex items-center gap-2 text-[11.5px] text-muted">
        <Sparkle size={12} className="text-[rgb(var(--copper))]/75" />
        {embedder?.label ?? '读取中'}
        {embedder?.dims ? (
          <span className="font-mono text-[10.5px] text-muted/65">{embedder.dims} 维</span>
        ) : null}
      </div>
      <Link
        href="/studio/settings#models"
        className="mt-3 inline-flex items-center gap-1 text-[11.5px] text-[rgb(var(--copper))]/90 hover:underline"
      >
        更换嵌入模型
      </Link>
    </Panel>
  );
}
