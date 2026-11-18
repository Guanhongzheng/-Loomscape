/**
 * Title suggestions shared by the chat tool `title_variants` and the MCP tool
 * of the same name. Deterministic on purpose: the model picks, we do not add a
 * second source of randomness.
 */
const PATTERNS: Array<(subject: string) => string> = [
  (s) => `${s}，以及它留下的痕迹`,
  (s) => `关于${s}的第二次说明`,
  (s) => `${s}：一份不合时宜的记录`,
  (s) => `在${s}结束之前`,
  (s) => `${s}的另一种用法`,
];

export const MAX_TITLES = 5;

export function titleVariants(subject: string, count = 3): { subject: string; titles: string[] } {
  const total = Math.min(Math.max(Math.trunc(count) || 3, 1), MAX_TITLES);
  const clean = subject.trim().slice(0, 18) || '未命名';
  return { subject: clean, titles: PATTERNS.slice(0, total).map((fn) => fn(clean)) };
}
