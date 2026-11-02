import { beforeEach, describe, expect, it } from 'vitest';
import {
  enableVault,
  isSealed,
  lockVault,
  openSecret,
  removeVault,
  sealSecret,
  unlockVault,
  vaultStatus,
} from '@/lib/vault';

class MemoryStorage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  removeVault();
});

describe('vault', () => {
  it('passes values through untouched while it is off', async () => {
    expect(vaultStatus()).toBe('off');
    expect(await sealSecret('sk-plain')).toBe('sk-plain');
    expect(await openSecret('sk-plain')).toBe('sk-plain');
  });

  it('seals and reopens a secret once enabled', async () => {
    await enableVault('correct horse battery');
    expect(vaultStatus()).toBe('unlocked');

    const sealed = await sealSecret('sk-live-123456');
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('sk-live');
    expect(await openSecret(sealed)).toBe('sk-live-123456');
  });

  it('uses a fresh IV, so the same key encrypts to different bytes', async () => {
    await enableVault('correct horse battery');
    const a = await sealSecret('sk-same');
    const b = await sealSecret('sk-same');
    expect(a).not.toBe(b);
    expect(await openSecret(a)).toBe('sk-same');
    expect(await openSecret(b)).toBe('sk-same');
  });

  it('cannot read anything while locked, and refuses to write plaintext', async () => {
    await enableVault('correct horse battery');
    const sealed = await sealSecret('sk-live-123456');
    lockVault();

    expect(vaultStatus()).toBe('locked');
    expect(await openSecret(sealed)).toBe('');
    await expect(sealSecret('sk-new')).rejects.toThrow('解锁');
  });

  it('unlocks with the right passphrase and rejects the wrong one', async () => {
    await enableVault('correct horse battery');
    lockVault();

    await expect(unlockVault('wrong passphrase')).rejects.toThrow('口令不正确');
    await unlockVault('correct horse battery');
    expect(vaultStatus()).toBe('unlocked');
  });

  it('refuses a short passphrase', async () => {
    await expect(enableVault('short')).rejects.toThrow('至少 8 位');
    expect(vaultStatus()).toBe('off');
  });

  it('leaves old ciphertext unreadable after removal', async () => {
    await enableVault('correct horse battery');
    const sealed = await sealSecret('sk-live-123456');
    removeVault();
    expect(vaultStatus()).toBe('off');
    // The prefix is still there, so it is not mistaken for a plaintext key.
    expect(isSealed(sealed)).toBe(true);
    expect(await openSecret(sealed)).toBe('');
  });

  it('tolerates a corrupt vault record instead of throwing on read', () => {
    localStorage.setItem('loomscape:vault', '{not json');
    expect(vaultStatus()).toBe('off');
  });
});
