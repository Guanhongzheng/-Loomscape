export type ShakeOptions = {
  /** Minimum horizontal distance for one direction segment. */
  minSegment?: number;
  /** Number of direction reversals required. */
  reversals?: number;
  /** Maximum gap between samples before the gesture resets. */
  idleMs?: number;
  /** Cooldown after a successful shake. */
  cooldownMs?: number;
};

/**
 * Small deterministic shake detector for a user-controlled cursor.
 *
 * It deliberately ignores tiny jitter: a reversal only counts after the pointer
 * has travelled a minimum distance in one direction. The caller still needs to
 * ignore drags and editable targets before feeding samples.
 */
export function createShakeDetector(options: ShakeOptions = {}) {
  const minSegment = options.minSegment ?? 8;
  const required = options.reversals ?? 3;
  const idleMs = options.idleMs ?? 260;
  const cooldownMs = options.cooldownMs ?? 900;

  let lastX: number | null = null;
  let lastT = 0;
  let direction = 0;
  let segment = 0;
  let reversals = 0;
  let cooldownUntil = 0;

  const resetMotion = () => {
    direction = 0;
    segment = 0;
    reversals = 0;
  };

  return {
    feed(x: number, t: number): boolean {
      if (t < cooldownUntil) {
        lastX = x;
        lastT = t;
        return false;
      }
      if (lastX === null) {
        lastX = x;
        lastT = t;
        return false;
      }
      const dx = x - lastX;
      const dt = t - lastT;
      lastX = x;
      lastT = t;
      if (!Number.isFinite(dx) || !Number.isFinite(dt) || dt < 0) return false;
      if (dt > idleMs) {
        resetMotion();
        return false;
      }
      const distance = Math.abs(dx);
      if (distance < 1.5) return false;
      segment += distance;
      const nextDirection = Math.sign(dx);
      if (direction === 0) {
        direction = nextDirection;
        return false;
      }
      if (nextDirection !== direction) {
        if (segment >= minSegment) {
          reversals += 1;
          segment = 0;
        }
        direction = nextDirection;
      }
      if (reversals >= required) {
        resetMotion();
        cooldownUntil = t + cooldownMs;
        return true;
      }
      return false;
    },
    reset() {
      lastX = null;
      lastT = 0;
      resetMotion();
    },
  };
}
