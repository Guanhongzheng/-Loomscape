import { describe, expect, it } from 'vitest';
import { createShakeDetector } from './shake';

const shake = (detector: ReturnType<typeof createShakeDetector>, xs: number[], start = 0, step = 40) => {
  let fired = false;
  xs.forEach((x, index) => {
    fired = detector.feed(x, start + index * step) || fired;
  });
  return fired;
};

describe('createShakeDetector', () => {
  it('detects three deliberate direction reversals', () => {
    const detector = createShakeDetector();
    expect(shake(detector, [100, 140, 100, 140, 100])).toBe(true);
  });

  it('ignores tiny jitter', () => {
    const detector = createShakeDetector();
    expect(shake(detector, [100, 103, 100, 103, 100, 103, 100])).toBe(false);
  });

  it('does not fire on a straight movement', () => {
    const detector = createShakeDetector();
    expect(shake(detector, [100, 140, 180, 220, 260, 300])).toBe(false);
  });

  it('resets after an idle gap', () => {
    const detector = createShakeDetector();
    detector.feed(100, 0);
    detector.feed(140, 40);
    detector.feed(100, 80);
    expect(detector.feed(140, 500)).toBe(false);
    expect(shake(detector, [100, 140, 100], 520)).toBe(false);
  });

  it('cools down after firing', () => {
    const detector = createShakeDetector();
    expect(shake(detector, [100, 140, 100, 140, 100])).toBe(true);
    expect(shake(detector, [100, 140, 100, 140, 100], 100)).toBe(false);
    expect(shake(detector, [100, 140, 100, 140, 100], 1400)).toBe(true);
  });

  it('reset clears partial movement', () => {
    const detector = createShakeDetector();
    detector.feed(100, 0);
    detector.feed(140, 40);
    detector.reset();
    expect(shake(detector, [100, 140, 100], 60)).toBe(false);
  });
});
