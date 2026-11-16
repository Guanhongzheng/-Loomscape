'use client';

import { create } from 'zustand';
import { STORES, get, put, all } from './db';
import { opaqueId, publicUid } from './id';

const SESSION_KEY = 'loomscape:session';
/** Set when the visitor signs out on purpose, so a reload cannot re-guest them. */
const SIGNED_OUT_KEY = 'loomscape:signed-out';
const ITERATIONS = 120_000;

export function wasSignedOut(): boolean {
  try {
    return localStorage.getItem(SIGNED_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

function clearSignedOut(): void {
  try {
    localStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // private mode without storage still works in memory
  }
}

function markSignedOut(): void {
  try {
    localStorage.setItem(SIGNED_OUT_KEY, '1');
  } catch {
    // ignore, the in-memory state is already signed out
  }
}

export type Profile = {
  id: string;
  uid: string;
  handle: string;
  /** Shown instead of `handle` when set; identity still keys on id/uid. */
  displayName?: string;
  /** One line about the person. */
  bio?: string;
  /**
   * A single 256×256 data URL. Uploading replaces it — there is no history on
   * purpose, so the record never grows past one image.
   */
  avatar?: string;
  profileUpdatedAt?: number;
  /**
   * Absent for guests on purpose. The users store has a unique index on
   * `email`, so an empty string made the second guest impossible to write:
   * IndexedDB rejected it with a ConstraintError and the dialog could only say
   * "无法创建访客会话".
   */
  email?: string;
  createdAt: number;
  guest?: boolean;
};

type StoredUser = Profile & { salt: string; hash: string };

type ProfilePatch = { displayName?: string; bio?: string; avatar?: string };

type AuthState = {
  user: Profile | null;
  ready: boolean;
  busy: boolean;
  hydrate: () => Promise<void>;
  register: (email: string, password: string, handle?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  enterAsGuest: () => Promise<void>;
  updateProfile: (patch: ProfilePatch) => Promise<void>;
  logout: () => void;
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function normalise(email: string) {
  return email.trim().toLowerCase();
}

function readSession(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { userId: string; expiresAt: number };
    if (!parsed.userId || parsed.expiresAt < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed.userId;
  } catch {
    return null;
  }
}

function writeSession(userId: string) {
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 14;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, expiresAt }));
}

export const useAuth = create<AuthState>((set, getState) => ({
  user: null,
  ready: false,
  busy: false,

  hydrate: async () => {
    if (getState().ready) return;
    const userId = readSession();
    if (!userId) {
      set({ ready: true });
      return;
    }
    try {
      const user = await get<StoredUser>(STORES.users, userId);
      if (user) {
        clearSignedOut();
        const { salt: _salt, hash: _hash, ...profile } = user;
        set({ user: profile, ready: true });
        return;
      }
    } catch {
      // storage may be blocked; fall through to the signed-out state
    }
    set({ ready: true });
  },

  register: async (email, password, handle) => {
    const address = normalise(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('请输入有效的邮箱地址');
    if (password.length < 8) throw new Error('密码至少需要 8 位字符');

    set({ busy: true });
    try {
      const existing = await all<StoredUser>(STORES.users);
      if (existing.some((row) => row.email === address)) throw new Error('该邮箱已注册');

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await derive(password, salt);
      const profile: StoredUser = {
        id: opaqueId('usr'),
        uid: publicUid(),
        handle: (handle?.trim() || address.split('@')[0]).slice(0, 24),
        email: address,
        createdAt: Date.now(),
        salt: toBase64(salt),
        hash,
      };
      await put(STORES.users, profile);
      writeSession(profile.id);
      clearSignedOut();
      const { salt: _salt, hash: _hash, ...rest } = profile;
      set({ user: rest, busy: false });
    } catch (error) {
      set({ busy: false });
      throw error;
    }
  },

  login: async (email, password) => {
    const address = normalise(email);
    set({ busy: true });
    try {
      const users = await all<StoredUser>(STORES.users);
      const record = users.find((row) => row.email === address);
      if (!record) throw new Error('邮箱或密码不正确');
      const hash = await derive(password, fromBase64(record.salt));
      if (!equal(hash, record.hash)) throw new Error('邮箱或密码不正确');
      writeSession(record.id);
      clearSignedOut();
      const { salt: _salt, hash: _hash, ...profile } = record;
      set({ user: profile, busy: false });
    } catch (error) {
      set({ busy: false });
      throw error;
    }
  },

  enterAsGuest: async () => {
    set({ busy: true });
    try {
      const profile: StoredUser = {
        id: opaqueId('guest'),
        uid: publicUid(),
        handle: '访客',
        // No email: a record without the indexed key is simply not indexed,
        // which is what keeps guests out of the unique constraint.
        createdAt: Date.now(),
        guest: true,
        salt: '',
        hash: '',
      };
      await put(STORES.users, profile);
      writeSession(profile.id);
      clearSignedOut();
      const { salt: _salt, hash: _hash, ...rest } = profile;
      set({ user: rest, busy: false });
    } catch (error) {
      // Without this the dialog stayed disabled after a blocked write.
      set({ busy: false });
      throw error;
    }
  },

  updateProfile: async (patch) => {
    const current = getState().user;
    if (!current) throw new Error('请先登录或使用访客身份');
    const stored = await get<StoredUser>(STORES.users, current.id);
    if (!stored) throw new Error('找不到当前用户记录');

    const next: StoredUser = { ...stored };

    if (patch.displayName !== undefined) {
      const value = patch.displayName.trim().slice(0, 24);
      if (value) next.displayName = value;
      else delete next.displayName;
    }
    if (patch.bio !== undefined) {
      const value = patch.bio.trim().slice(0, 40);
      if (value) next.bio = value;
      else delete next.bio;
    }
    if (patch.avatar !== undefined) {
      const value = patch.avatar;
      if (!value) {
        delete next.avatar;
      } else if (/^data:image\/(png|jpeg|webp);base64,/.test(value) && value.length <= 400_000) {
        next.avatar = value;
      } else {
        throw new Error('头像数据无效');
      }
    }
    next.profileUpdatedAt = Date.now();

    await put(STORES.users, next);
    const { salt: _salt, hash: _hash, ...profile } = next;
    set({ user: profile });
  },

  logout: () => {
    try {
      localStorage.removeItem(SESSION_KEY);
      markSignedOut();
    } catch {
      // storage may be blocked; the in-memory state below is still correct
    }
    set({ user: null, ready: true });
  },
}));
