import type { GpuPrecision, ResidentPool } from './engines';

/**
 * Three ways to spend the same machine. They only differ in knobs the runtime
 * actually reads when a session is opened — thread caps, the WebGPU weight
 * format, and how many sessions may share one memory pool — so switching a
 * profile never requires a code path of its own.
 */
export type SchedulingProfile = 'balanced' | 'lean' | 'throughput';

export type ScheduleSpec = {
  id: SchedulingProfile;
  label: string;
  /** One line, shown under the picker: what this profile trades away. */
  note: string;
  threads: { text: number; embedding: number };
  gpuPrecision: GpuPrecision;
  /** Sessions allowed to share one pool. Two tasks exist, so 2 means "no cap". */
  maxResidents: Record<ResidentPool, number>;
};

export const SCHEDULE_ORDER: SchedulingProfile[] = ['balanced', 'lean', 'throughput'];

export const DEFAULT_PROFILE: SchedulingProfile = 'balanced';

/**
 * `balanced` is the behaviour the app already had: a decoder on two threads, an
 * embedder on four, fp16 weights, and coexistence whenever the pool has room.
 * It is the baseline, not an optimisation — picking it changes nothing.
 */
export const SCHEDULES: Record<SchedulingProfile, ScheduleSpec> = {
  balanced: {
    id: 'balanced',
    label: '均衡',
    note: '默认档：文本 2 线程、嵌入 4 线程，fp16；两个会话在预算内共存。',
    threads: { text: 2, embedding: 4 },
    gpuPrecision: 'fp16',
    maxResidents: { wasm: 2, gpu: 2 },
  },
  lean: {
    id: 'lean',
    label: '省内存',
    note: '单线程文本、4 位权重、每池只留一个会话；代价是文本与嵌入二选一，检索退回哈希。',
    threads: { text: 1, embedding: 2 },
    gpuPrecision: 'q4f16',
    maxResidents: { wasm: 1, gpu: 1 },
  },
  throughput: {
    id: 'throughput',
    label: '高吞吐',
    note: '文本 4 线程；提速主要在长提示的 prefill 与嵌入批处理，逐字生成的收益有限。',
    threads: { text: 4, embedding: 4 },
    gpuPrecision: 'fp16',
    maxResidents: { wasm: 2, gpu: 2 },
  },
};

/** Unknown or stale values fall back to the baseline instead of throwing. */
export function resolveSchedule(profile?: SchedulingProfile | null): ScheduleSpec {
  return SCHEDULES[profile ?? DEFAULT_PROFILE] ?? SCHEDULES[DEFAULT_PROFILE];
}

export function isProfile(value: unknown): value is SchedulingProfile {
  return value === 'balanced' || value === 'lean' || value === 'throughput';
}

/**
 * The cap handed to `threadCount`. Sharing a heap with a decoder halves the
 * embedder's threads regardless of profile — that rule lives in `threadCount`,
 * not here, so a profile can never hand out more memory than the pool has.
 */
export function threadCap(profile: SchedulingProfile | undefined, task: 'text' | 'embedding'): number {
  const spec = resolveSchedule(profile);
  return task === 'text' ? spec.threads.text : spec.threads.embedding;
}

export function residentCap(profile: SchedulingProfile | undefined, pool: ResidentPool): number {
  return resolveSchedule(profile).maxResidents[pool];
}

/**
 * The picker shows a preset as active only when every knob still agrees with
 * it. Changing precision by hand leaves the profile name alone, so the card
 * has to say "自定义" rather than claim a preset it no longer matches.
 */
export function matchesProfile(profile: SchedulingProfile, precision: GpuPrecision): boolean {
  return resolveSchedule(profile).gpuPrecision === precision;
}
