'use client';

import { create } from 'zustand';
import { STORES, get, put, all } from './db';
import { opaqueId, publicUid } from './id';

const SESSION_KEY = 'loomscape:session';
const ITERATIONS = 120_000;

export type Profile = {
  id: string;
  uid: string;
  handle: string;
  email: string;
  createdAt: number;
  guest?: boolean;
};

type StoredUser = Profile & { salt: string; hash: string };

type AuthState = {
  user: Profile | null;
  ready: boolean;
  busy: boolean;
  hydrate: () => Promise<void>;
  register: (email: string, password: string, handle?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  enterAsGuest: () => Promise<void>;
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
      const { salt: _salt, hash: _hash, ...profile } = record;
      set({ user: profile, busy: false });
    } catch (error) {
      set({ busy: false });
      throw error;
    }
  },

  enterAsGuest: async () => {
    set({ busy: true });
    const profile: StoredUser = {
      id: opaqueId('guest'),
      uid: publicUid(),
      handle: '访客',
      email: '',
      createdAt: Date.now(),
      guest: true,
      salt: '',
      hash: '',
    };
    await put(STORES.users, profile);
    writeSession(profile.id);
    const { salt: _salt, hash: _hash, ...rest } = profile;
    set({ user: rest, busy: false });
  },

  logout: () => {
    localStorage.removeItem(SESSION_KEY);
    set({ user: null });
  },
}));
