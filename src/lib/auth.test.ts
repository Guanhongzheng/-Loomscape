import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORES, all, resetConnection } from '@/lib/db';
import { useAuth, wasSignedOut } from '@/lib/auth';

type Stored = { id: string; email?: string; guest?: boolean; handle: string };

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

describe('guest identity', () => {
  beforeEach(async () => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
    resetConnection();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('loomscape');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    useAuth.setState({ user: null, ready: false, busy: false });
  });

  it('creates a second guest after the first one signed out', async () => {
    // The users store has a unique index on `email`. Guests used to carry
    // email: '', so the second guest hit a ConstraintError and the UI could
    // only report "无法创建访客会话".
    await useAuth.getState().enterAsGuest();
    const first = useAuth.getState().user;
    expect(first?.guest).toBe(true);

    useAuth.getState().logout();
    await expect(useAuth.getState().enterAsGuest()).resolves.toBeUndefined();
    const second = useAuth.getState().user;
    expect(second?.guest).toBe(true);
    expect(second?.uid).not.toBe(first?.uid);

    const rows = await all<Stored>(STORES.users);
    expect(rows).toHaveLength(2);
    // Guests are not indexed by email at all.
    expect(rows.every((row) => row.email === undefined)).toBe(true);
  });

  it('still lets a real account be registered after a guest session', async () => {
    await useAuth.getState().enterAsGuest();
    useAuth.getState().logout();
    await useAuth.getState().register('editor@loom.test', 'loomscape-2026', '夜班编辑');

    expect(useAuth.getState().user?.handle).toBe('夜班编辑');
    expect(useAuth.getState().user?.guest).toBeUndefined();

    useAuth.getState().logout();
    await useAuth.getState().login('editor@loom.test', 'loomscape-2026');
    expect(useAuth.getState().user?.email).toBe('editor@loom.test');
  });

  it('keeps the unique email rule for accounts', async () => {
    await useAuth.getState().register('editor@loom.test', 'loomscape-2026');
    useAuth.getState().logout();
    await expect(useAuth.getState().register('editor@loom.test', 'loomscape-2026')).rejects.toThrow(
      /已注册/,
    );
  });

  it('remembers an explicit sign-out across a reload', async () => {
    await useAuth.getState().enterAsGuest();
    useAuth.getState().logout();
    expect(wasSignedOut()).toBe(true);

    // A fresh page load: no session, and the flag keeps the app signed out.
    useAuth.setState({ user: null, ready: false });
    await useAuth.getState().hydrate();
    expect(useAuth.getState().user).toBeNull();
  });

  it('clears the flag once a guest enters again', async () => {
    useAuth.getState().logout();
    expect(wasSignedOut()).toBe(true);
    await useAuth.getState().enterAsGuest();
    expect(wasSignedOut()).toBe(false);
  });
});
