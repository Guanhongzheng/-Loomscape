'use client';

import { STORES, all, put } from './db';
import { EMPTY_ENDPOINTS, type Channel, type Endpoint } from './providers';
import { useEndpoints } from './endpoint-store';
import { lockVault } from './vault';

const STORAGE_KEY = 'loomscape:vault';
const CHANNELS: Channel[] = ['text', 'image', 'speech', 'embedding'];

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('');
}

/**
 * "I forgot the passphrase" — the only honest exit.
 *
 * The vault key is derived from a passphrase that is never stored, so forgetting
 * it means the ciphertext is unrecoverable by design. This drops the derived
 * key from memory, overwrites the on-disk records before deleting them, and
 * empties every channel's API key so nothing usable is left behind.
 *
 * Overwriting is best-effort: browsers and SSDs may keep old blocks, so this
 * narrows the window rather than promising forensic erasure.
 */
export async function resetVaultAndKeys(): Promise<{ hadVault: boolean; channels: number }> {
  lockVault();

  let hadVault = false;
  try {
    const storage = window.localStorage;
    hadVault = Boolean(storage.getItem(STORAGE_KEY));
    if (hadVault) {
      // Overwrite the ciphertext + salt with noise before removing the key.
      storage.setItem(STORAGE_KEY, randomHex(512));
      storage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage blocked; the in-memory key is already gone.
  }

  let channels = 0;
  try {
    const rows = await all<Endpoint>(STORES.providers);
    for (const row of rows) {
      if (!row || !row.channel) continue;
      // Two writes: first replace the secret with noise, then store it empty,
      // so a stale page cannot resurrect the old ciphertext.
      await put(STORES.providers, { ...row, apiKey: randomHex(128) });
      await put(STORES.providers, { ...row, apiKey: '' });
      channels += 1;
    }
  } catch {
    // A failing store should not stop the vault from being dropped.
  }

  // Anything decrypted during this session lives in the zustand store.
  useEndpoints.setState({
    endpoints: { ...EMPTY_ENDPOINTS },
    health: { text: false, image: false, speech: false, embedding: false },
  });

  return { hadVault, channels };
}

export const VAULT_CHANNELS = CHANNELS;
