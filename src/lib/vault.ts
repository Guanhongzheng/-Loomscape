'use client';

/**
 * Optional encryption for provider keys at rest.
 *
 * The keys already live in IndexedDB, which is per-origin and not readable by
 * other sites — but it is plaintext, so anything that can run script on this
 * origin (a supply-chain slip, an injected tag) can read them. Encrypting them
 * with a passphrase only helps if the passphrase is never stored: the derived
 * key lives in memory, the salt and a verifier live on disk.
 *
 * PBKDF2-SHA256, 210k iterations, AES-GCM-256, a fresh IV per value. A wrong
 * passphrase is detected by decrypting a small known payload, not by a hash
 * comparison, so there is no separate verifier to attack.
 */

const STORAGE_KEY = 'loomscape:vault';
const ITERATIONS = 210_000;
const PREFIX = 'vault:1:';
const CHECK_TEXT = 'loomscape-vault-check';

type Record = {
  v: 1;
  salt: string;
  iterations: number;
  check: { iv: string; ct: string };
};

export type VaultStatus = 'off' | 'locked' | 'unlocked';

let key: CryptoKey | null = null;

function store(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function readRecord(): Record | null {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record;
    if (parsed.v !== 1 || !parsed.salt || !parsed.check) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function derive(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptWith(target: CryptoKey, text: string): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    target,
    new TextEncoder().encode(text),
  );
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

async function decryptWith(target: CryptoKey, iv: string, ct: string): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    target,
    fromBase64(ct),
  );
  return new TextDecoder().decode(plain);
}

export function vaultStatus(): VaultStatus {
  if (!readRecord()) return 'off';
  return key ? 'unlocked' : 'locked';
}

/** Creates the vault and unlocks it. Throws when the passphrase is too short. */
export async function enableVault(passphrase: string): Promise<void> {
  if (passphrase.trim().length < 8) throw new Error('口令至少 8 位');
  const storage = store();
  if (!storage) throw new Error('浏览器不允许本地存储，无法启用保险箱');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derive(passphrase, salt, ITERATIONS);
  const check = await encryptWith(derived, CHECK_TEXT);
  const record: Record = {
    v: 1,
    salt: toBase64(salt),
    iterations: ITERATIONS,
    check,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(record));
  key = derived;
}

export async function unlockVault(passphrase: string): Promise<void> {
  const record = readRecord();
  if (!record) throw new Error('还没有启用保险箱');
  const derived = await derive(passphrase, fromBase64(record.salt), record.iterations);
  try {
    const text = await decryptWith(derived, record.check.iv, record.check.ct);
    if (text !== CHECK_TEXT) throw new Error('口令不正确');
  } catch {
    throw new Error('口令不正确');
  }
  key = derived;
}

export function lockVault(): void {
  key = null;
}

/** Destroys the vault record; sealed keys stay unreadable and must be re-entered. */
export function removeVault(): void {
  key = null;
  try {
    store()?.removeItem(STORAGE_KEY);
  } catch {
    // nothing else to do; the record will be overwritten on the next enable
  }
}

/** Seals a secret. Plaintext passes through when the vault is off. */
export async function sealSecret(value: string): Promise<string> {
  if (!value) return '';
  if (vaultStatus() === 'off') return value;
  if (!key) throw new Error('密钥保险箱未解锁');
  const { iv, ct } = await encryptWith(key, value);
  return `${PREFIX}${iv}:${ct}`;
}

/** Opens a sealed secret. Returns '' when it is sealed and the vault is locked. */
export async function openSecret(value: string): Promise<string> {
  if (!value.startsWith(PREFIX)) return value;
  if (!key) return '';
  const [iv, ct] = value.slice(PREFIX.length).split(':');
  if (!iv || !ct) return '';
  try {
    return await decryptWith(key, iv, ct);
  } catch {
    return '';
  }
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}
