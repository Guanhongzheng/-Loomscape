'use client';

import type { ResidentPool } from './engines';

/**
 * Two tabs loading the same decoder means two copies of the weights in two
 * wasm heaps — 2.4GB each for a 0.6B int8 session — and the second one usually
 * ends in `Aborted()` while the first tab is still working.
 *
 * The lock is a Web Lock (`navigator.locks`), which is atomic across tabs and
 * released by the browser when a tab dies, so a crash cannot wedge the app.
 * A `localStorage` record rides along for two things a lock cannot tell us:
 * which model a tab is holding and how much memory it claims, which is what
 * stops two *different* models from oversubscribing the same machine.
 *
 * The first attempt used only a BroadcastChannel; a second tab decided on an
 * empty table before the reply arrived and loaded a duplicate, so the channel
 * is gone. `localStorage` is also kept as the fallback path for browsers
 * without Web Locks.
 */

export type Claim = {
  modelId: string;
  tabId: string;
  at: number;
  pool: ResidentPool;
  /** Estimated peak of the resident session, in MB. */
  peakMB: number;
};

/** A tab that stops heartbeating (crash, sleep) is forgotten after this. */
export const CLAIM_TTL_MS = 45_000;
export const HEARTBEAT_MS = 15_000;

const PREFIX = 'loomscape:model-claim:';
/** Candidates in the no-Web-Locks path; separate prefix so sums ignore them. */
const INTENT_PREFIX = 'loomscape:model-intent:';
/** How long two tabs collect intents before deciding who won. */
const INTENT_SETTLE_MS = 120;

export type Intent = { modelId: string; tabId: string; at: number };

/**
 * The no-Web-Locks tie-break. Both tabs write an intent, wait for the settle
 * window, then read the same set — so they must agree on one winner. Earliest
 * intent wins; a tie (same millisecond) is broken by tab id, which is random
 * but identical on both sides.
 */
export function pickIntentWinner(
  intents: Intent[],
  now: number,
  ttl = 5_000,
): string | null {
  const fresh = intents
    .filter((intent) => now - intent.at <= ttl)
    .sort((a, b) => a.at - b.at || a.tabId.localeCompare(b.tabId));
  return fresh[0]?.tabId ?? null;
}

/** Pure half: parse and validate one stored claim. */
export function readClaim(
  raw: string | null,
  now: number,
  ownTabId: string,
  ttl = CLAIM_TTL_MS,
): Claim | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const claim = parsed as Partial<Claim>;
  if (typeof claim.modelId !== 'string' || typeof claim.tabId !== 'string') return null;
  if (typeof claim.at !== 'number' || !Number.isFinite(claim.at)) return null;
  if (claim.pool !== 'wasm' && claim.pool !== 'gpu') return null;
  if (typeof claim.peakMB !== 'number' || !Number.isFinite(claim.peakMB)) return null;
  if (claim.tabId === ownTabId) return null;
  if (now - claim.at > ttl) return null;
  return claim as Claim;
}

/** Memory other tabs already claim in one pool. */
export function claimedMB(claims: Iterable<Claim>, pool: ResidentPool): number {
  let total = 0;
  for (const claim of claims) if (claim.pool === pool) total += claim.peakMB;
  return total;
}

/**
 * Whether one more session would push the machine past a pool's ceiling.
 * `ownMB` is this tab's own residents, `otherMB` what the other tabs claim.
 * The base overhead is counted once, by the tab doing the loading.
 */
export function fitsAcrossTabs(
  ownMB: number,
  otherMB: number,
  extraMB: number,
  baseMB: number,
  ceilingMB: number,
): boolean {
  if (otherMB <= 0) return true;
  return baseMB + ownMB + otherMB + extraMB <= ceilingMB;
}

type Meta = { pool: ResidentPool; peakMB: number };

class TabClaims {
  readonly tabId = Math.random().toString(36).slice(2);
  private held = new Map<string, { meta: Meta; release?: () => void }>();
  private timer: ReturnType<typeof setInterval> | null = null;

  private store(): Storage | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const probe = `${PREFIX}probe`;
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    } catch {
      return null;
    }
  }

  private write(modelId: string, meta: Meta, at = Date.now()): void {
    try {
      this.store()?.setItem(
        `${PREFIX}${modelId}`,
        JSON.stringify({ modelId, tabId: this.tabId, at, ...meta } satisfies Claim),
      );
    } catch {
      // best-effort: a full store must not stop a model from loading
    }
  }

  private beat(): void {
    for (const [modelId, entry] of this.held) this.write(modelId, entry.meta);
  }

  private ensureTimer(): void {
    if (this.timer !== null || this.held.size === 0) return;
    this.timer = setInterval(() => this.beat(), HEARTBEAT_MS);
  }

  private intentsFor(modelId: string): Intent[] {
    const store = this.store();
    if (!store) return [];
    const prefix = `${INTENT_PREFIX}${modelId}:`;
    const out: Intent[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (!key?.startsWith(prefix)) continue;
      try {
        const parsed = JSON.parse(store.getItem(key) ?? 'null') as Intent | null;
        if (parsed && typeof parsed.tabId === 'string' && typeof parsed.at === 'number') {
          out.push(parsed);
        }
      } catch {
        // an unreadable intent cannot win and will be overwritten anyway
      }
    }
    return out;
  }

  /**
   * Fallback for browsers without Web Locks: write an intent, let the settle
   * window pass so a simultaneously-starting tab is visible, then apply the
   * same tie-break on both sides. This is slower than a lock but deterministic,
   * which the previous "read then write" version was not.
   */
  private async acquireByIntent(modelId: string, meta: Meta): Promise<boolean> {
    const store = this.store();
    if (!store) {
      // No storage at all: nothing to coordinate with.
      this.held.set(modelId, { meta });
      return true;
    }

    const key = `${INTENT_PREFIX}${modelId}:${this.tabId}`;
    try {
      store.setItem(key, JSON.stringify({ modelId, tabId: this.tabId, at: Date.now() }));
    } catch {
      this.held.set(modelId, { meta });
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, INTENT_SETTLE_MS));
    const winner = pickIntentWinner(this.intentsFor(modelId), Date.now());
    try {
      store.removeItem(key);
    } catch {
      // the intent expires on its own
    }

    if (winner !== this.tabId) return false;
    if (this.holderElsewhere(modelId)) return false;

    this.held.set(modelId, { meta });
    this.write(modelId, meta);
    this.ensureTimer();
    return true;
  }

  /**
   * Takes the cross-tab lock for one model. Resolves false when another tab
   * holds it. The lock stays held until `release`, which keeps a crashed tab
   * from leaving a stale claim: the browser drops the lock when it dies.
   */
  async acquire(modelId: string, meta: Meta): Promise<boolean> {
    const existing = this.held.get(modelId);
    if (existing) return true;

    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks) return this.acquireByIntent(modelId, meta);

    let release: (() => void) | undefined;
    const heldUntil = new Promise<void>((resolve) => {
      release = resolve;
    });
    let granted = false;

    const answered = new Promise<boolean>((resolve) => {
      locks
        .request(`loomscape:model:${modelId}`, { ifAvailable: true }, async (lock) => {
          granted = lock !== null;
          resolve(granted);
          if (lock) await heldUntil;
        })
        .catch(() => resolve(false));
    });

    if (!(await answered)) return false;
    this.held.set(modelId, { meta, release });
    this.write(modelId, meta);
    this.ensureTimer();
    return true;
  }

  release(modelId: string): void {
    const entry = this.held.get(modelId);
    if (!entry) return;
    this.held.delete(modelId);
    entry.release?.();
    try {
      this.store()?.removeItem(`${PREFIX}${modelId}`);
    } catch {
      // the record expires on its own
    }
    if (this.held.size === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  releaseAll(): void {
    for (const modelId of Array.from(this.held.keys())) this.release(modelId);
  }

  holderElsewhere(modelId: string): Claim | undefined {
    try {
      const raw = this.store()?.getItem(`${PREFIX}${modelId}`) ?? null;
      return readClaim(raw, Date.now(), this.tabId) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Live claims from other tabs, for the memory sum. */
  others(): Claim[] {
    const store = this.store();
    if (!store) return [];
    const out: Claim[] = [];
    const now = Date.now();
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (!key?.startsWith(PREFIX) || key.endsWith('probe')) continue;
      const claim = readClaim(store.getItem(key), now, this.tabId);
      if (claim) out.push(claim);
    }
    return out;
  }

  /** Tests only. */
  reset(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const entry of this.held.values()) entry.release?.();
    this.held.clear();
  }
}

let instance: TabClaims | null = null;

function claims(): TabClaims {
  if (!instance) {
    instance = new TabClaims();
    if (typeof window !== 'undefined') {
      // Closing the tab must not leave a claim that blocks the next visit.
      window.addEventListener('beforeunload', () => instance?.releaseAll());
    }
  }
  return instance;
}

export function acquireModelLock(modelId: string, meta: Meta): Promise<boolean> {
  return claims().acquire(modelId, meta);
}

export function releaseModelLock(modelId: string): void {
  claims().release(modelId);
}

export function releaseAllModelLocks(): void {
  claims().releaseAll();
}

export function holderElsewhere(modelId: string): Claim | undefined {
  return claims().holderElsewhere(modelId);
}

export function claimedElsewhere(pool: ResidentPool): number {
  return claimedMB(claims().others(), pool);
}

export function ownTabId(): string {
  return claims().tabId;
}

export function resetTabClaims(): void {
  instance?.reset();
  instance = null;
}
