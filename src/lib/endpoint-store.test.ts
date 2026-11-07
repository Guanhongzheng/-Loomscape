import { describe, expect, it } from 'vitest';
import { channelReady, needsVaultUnlock } from '@/lib/endpoint-store';
import { EMPTY_ENDPOINTS, type Endpoint } from '@/lib/providers';

const health = (text = false) => ({ text, image: false, speech: false, embedding: false });

const state = (patch: Partial<Endpoint> = {}, serverKey = false) => ({
  endpoints: {
    ...EMPTY_ENDPOINTS,
    text: { ...EMPTY_ENDPOINTS.text, ...patch },
  },
  health: health(serverKey),
});

describe('needsVaultUnlock', () => {
  it('is true when the stored key is sealed and the vault is locked', () => {
    expect(needsVaultUnlock(state({ sealed: true }), 'text')).toBe(true);
  });

  it('is false when a usable key is already in memory', () => {
    expect(
      needsVaultUnlock(state({ sealed: true, apiKey: 'sk-test-123456789' }), 'text'),
    ).toBe(false);
  });

  it('is false when the server supplies the key through the environment', () => {
    // A locked browser vault must not block a deployment whose /api/health
    // reports credentials; that channel never needed the key in the first place.
    expect(needsVaultUnlock(state({ sealed: true }, true), 'text')).toBe(false);
    expect(channelReady(state({ sealed: true }, true), 'text')).toBe(true);
  });

  it('is false for a channel that was never configured', () => {
    expect(needsVaultUnlock(state(), 'text')).toBe(false);
    expect(needsVaultUnlock(state({ sealed: false }), 'text')).toBe(false);
  });
});
