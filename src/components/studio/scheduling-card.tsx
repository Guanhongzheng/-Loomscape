'use client';

import { useEffect, useState } from 'react';
import { Segmented } from '@/components/ui/controls';
import { Panel } from '@/components/studio/workbench';
import { toast } from '@/components/ui/toast';
import {
  GPU_BASE_MB,
  POOL_LABEL,
  RUNTIME_BASE_MB,
  formatBytes,
  poolBudgetMB,
  poolOf,
  poolPeakMB,
  useEngines,
  useModelRuntime,
  type GpuPrecision,
  type ResidentPool,
} from '@/lib/engines';
import { runtimeInfo, threadCount } from '@/lib/local-runtime';
import {
  SCHEDULES,
  SCHEDULE_ORDER,
  matchesProfile,
  resolveSchedule,
  threadCap,
  type SchedulingProfile,
} from '@/lib/scheduling';
import { cn } from '@/lib/cn';

const PRECISION_LABEL: Record<GpuPrecision, string> = {
  fp16: 'fp16',
  q4f16: '4 位',
};

/**
 * The scheduling strategy, in one card: three presets over the knobs the
 * runtime actually reads (thread caps, weight precision, sessions per pool),
 * plus the two budgets they are spent from.
 *
 * Everything here is *next load*: a resident session keeps the threads it was
 * opened with, so switching a profile mid-conversation changes nothing until
 * that model is reloaded. Saying so on the card is cheaper than pretending
 * the switch is live.
 */
export function SchedulingCard() {
  const prefs = useEngines((state) => state.prefs);
  const patch = useEngines((state) => state.patch);
  const residents = useModelRuntime((state) => state.residents);

  // `navigator` does not exist during the server render; the card starts from
  // the single-threaded assumption and corrects itself on mount.
  const [facts, setFacts] = useState<{ cores: number; isolated: boolean; memory?: number }>({
    cores: 4,
    isolated: false,
  });
  useEffect(() => {
    const info = runtimeInfo();
    const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    setFacts({ cores: info.cores, isolated: info.isolated, memory });
  }, []);

  const spec = resolveSchedule(prefs.profile);
  const custom = !matchesProfile(prefs.profile, prefs.gpuPrecision);
  const threadsOf = (task: 'text' | 'embedding') =>
    threadCount(facts.cores, facts.isolated, task, false, threadCap(prefs.profile, task));
  const textThreads = threadsOf('text');
  const embedThreads = threadsOf('embedding');

  const pick = async (next: SchedulingProfile) => {
    const target = SCHEDULES[next];
    await patch({ profile: next, gpuPrecision: target.gpuPrecision });
    toast(`已切换到「${target.label}」，下次加载生效`, 'success');
  };

  return (
    <Panel
      id="scheduling"
      title="调度策略"
      hint="线程、精度与并发上限；改动在下次加载生效"
      className="scroll-mt-6"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            size="sm"
            value={prefs.profile}
            onChange={(next) => void pick(next)}
            options={SCHEDULE_ORDER.map((id) => ({ value: id, label: SCHEDULES[id].label }))}
          />
          {custom ? (
            <span className="rounded-full border border-[rgb(var(--line))]/70 px-2 py-0.5 text-[10.5px] text-muted">
              精度已单独调整
            </span>
          ) : null}
        </div>

        <p className="-mt-1 text-[11px] leading-relaxed text-muted/75">{spec.note}</p>

        <div className="grid gap-2.5 sm:grid-cols-3">
          <Tile
            label="线程"
            value={`文本 ${textThreads} · 嵌入 ${embedThreads}`}
            note={
              facts.isolated
                ? spec.maxResidents.wasm === 1
                  ? '每池只留一个会话，不存在共存降档'
                  : `两者共存时嵌入降到 ${Math.min(embedThreads, 2)}`
                : '未开启跨源隔离，只能单线程'
            }
          />
          <Tile
            label="权重精度"
            value={PRECISION_LABEL[prefs.gpuPrecision]}
            note={prefs.backend === 'webgpu' ? '4 位只作用于文本模型' : 'WASM 一律 int8'}
          />
          <Tile
            label="每池会话"
            value={`≤ ${spec.maxResidents.wasm} 个`}
            note={spec.maxResidents.wasm === 1 ? '文本与嵌入二选一' : 'WASM 与显存分开计数'}
          />
        </div>

        <div className="max-w-[560px] space-y-2">
          {(['wasm', 'gpu'] as ResidentPool[]).map((pool) => {
            const used = poolPeakMB(residents, pool);
            const budget = poolBudgetMB(pool);
            const share = Math.min(100, Math.round((used / budget) * 100));
            const count = residents.filter((row) => poolOf(row.backend) === pool).length;
            return (
              <div key={pool} className="flex items-center gap-3">
                <span
                  className="w-[76px] shrink-0 text-[11px] text-muted"
                  title={`含运行时固定开销 ${pool === 'gpu' ? GPU_BASE_MB : RUNTIME_BASE_MB}MB`}
                >
                  {POOL_LABEL[pool]} · {count} 个
                </span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[rgb(var(--line))]/50">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-300',
                      pool === 'gpu' ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--accent))]/75',
                    )}
                    style={{ width: `${used > 0 ? Math.max(share, 2) : 0}%` }}
                  />
                </div>
                <span className="w-[116px] shrink-0 text-right font-mono text-[10.5px] text-muted/65">
                  {formatBytes(used * 1024 * 1024)} / {(budget / 1024).toFixed(1)} GB
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] leading-relaxed text-muted/70">
          已在内存的会话保持原线程与精度，换档只影响下一次加载；要立刻生效，在「本地模型」里卸载后重新加载。
          预算按设备内存估算
          {facts.memory ? `（${facts.memory}GB）` : '（浏览器未报告，按 8GB）'}，小内存机器会提前拒绝而不是崩溃。
        </p>
      </div>
    </Panel>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-white/50 bg-white/35 px-3.5 py-3 backdrop-blur-md">
      <div className="text-[11px] text-muted/85">{label}</div>
      <div className="mt-1 text-[14px] text-ink">{value}</div>
      <div className="mt-0.5 text-[10.5px] leading-relaxed text-muted/70">{note}</div>
    </div>
  );
}
