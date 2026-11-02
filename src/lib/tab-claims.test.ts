import { describe, expect, it } from 'vitest';
import {
  CLAIM_TTL_MS,
  claimedMB,
  fitsAcrossTabs,
  pickIntentWinner,
  readClaim,
  type Claim,
  type Intent,
} from '@/lib/tab-claims';

const claim = (patch: Partial<Claim> = {}): Claim => ({
  modelId: 'qwen3-0.6b',
  tabId: 'other',
  at: 1_000,
  pool: 'wasm',
  peakMB: 2_400,
  ...patch,
});

const raw = (value: Claim | string) => (typeof value === 'string' ? value : JSON.stringify(value));

describe('readClaim', () => {
  it('ignores what this tab wrote itself', () => {
    expect(readClaim(raw(claim({ tabId: 'me' })), 1_100, 'me')).toBeNull();
  });

  it('returns another tab’s live claim', () => {
    expect(readClaim(raw(claim()), 1_100, 'me')?.tabId).toBe('other');
  });

  it('forgets a claim once the tab stops heartbeating', () => {
    // A crashed or sleeping tab must not wedge the app forever.
    expect(readClaim(raw(claim({ at: 0 })), CLAIM_TTL_MS + 1, 'me')).toBeNull();
  });

  it('treats junk as no claim, so a corrupt entry cannot block a load', () => {
    expect(readClaim('not json', 1_000, 'me')).toBeNull();
    expect(readClaim('{}', 1_000, 'me')).toBeNull();
    expect(readClaim(raw({ modelId: 'x', tabId: 'other' } as never), 1_000, 'me')).toBeNull();
    expect(readClaim(null, 1_000, 'me')).toBeNull();
  });

  it('requires the pool and size, which the cross-tab budget sums', () => {
    const { pool: _pool, ...noPool } = claim();
    const { peakMB: _peak, ...noSize } = claim();
    expect(readClaim(raw(noPool as never), 1_100, 'me')).toBeNull();
    expect(readClaim(raw(noSize as never), 1_100, 'me')).toBeNull();
  });
});

describe('claimedMB', () => {
  it('sums one pool and ignores the other', () => {
    const claims = [
      claim({ modelId: 'a', peakMB: 1_000 }),
      claim({ modelId: 'b', peakMB: 500 }),
      claim({ modelId: 'c', pool: 'gpu', peakMB: 3_000 }),
    ];
    expect(claimedMB(claims, 'wasm')).toBe(1_500);
    expect(claimedMB(claims, 'gpu')).toBe(3_000);
  });
});

describe('fitsAcrossTabs', () => {
  it('never blocks when no other tab claims anything', () => {
    expect(fitsAcrossTabs(3_000, 0, 500, 600, 3_400)).toBe(true);
  });

  it('counts the base once, by the tab that is loading', () => {
    // 600 base + 1200 own + 800 elsewhere + 700 new = 3300 ≤ 3400
    expect(fitsAcrossTabs(1_200, 800, 700, 600, 3_400)).toBe(true);
    // one more megabyte pushes it over
    expect(fitsAcrossTabs(1_200, 800, 801, 600, 3_400)).toBe(false);
  });
});

const intent = (tabId: string, at: number): Intent => ({ modelId: 'qwen3-0.6b', tabId, at });

describe('pickIntentWinner', () => {
  it('lets a lone intent through', () => {
    expect(pickIntentWinner([intent('a', 1_000)], 1_100)).toBe('a');
  });

  it('prefers the earliest intent', () => {
    expect(pickIntentWinner([intent('b', 1_050), intent('a', 1_000)], 1_100)).toBe('a');
  });

  it('breaks a same-millisecond tie by tab id, so both tabs agree', () => {
    // Deterministic on purpose: both sides sort the same list and pick the
    // same winner, which is what the old read-then-write version lacked.
    expect(pickIntentWinner([intent('zz', 1_000), intent('aa', 1_000)], 1_100)).toBe('aa');
  });

  it('ignores intents left behind by a dead tab', () => {
    expect(pickIntentWinner([intent('a', 0)], 10_000)).toBeNull();
  });

  it('has no winner with no intents', () => {
    expect(pickIntentWinner([], 1_100)).toBeNull();
  });
});
