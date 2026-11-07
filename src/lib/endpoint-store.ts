'use client';

import { create } from 'zustand';
import { readHealth, type Health } from './api';
import {
  EMPTY_ENDPOINTS,
  hasKey,
  loadEndpoints,
  saveEndpoint,
  type Channel,
  type Endpoint,
} from './providers';

type EndpointState = {
  endpoints: Record<Channel, Endpoint>;
  health: Health;
  loaded: boolean;
  load: () => Promise<void>;
  store: (endpoint: Endpoint) => Promise<void>;
};

export const useEndpoints = create<EndpointState>((set) => ({
  endpoints: EMPTY_ENDPOINTS,
  health: { text: false, image: false, speech: false, embedding: false },
  loaded: false,

  load: async () => {
    const [endpoints, health] = await Promise.all([loadEndpoints(), readHealth()]);
    set({ endpoints, health, loaded: true });
  },

  store: async (endpoint) => {
    await saveEndpoint(endpoint);
    set((state) => ({ endpoints: { ...state.endpoints, [endpoint.channel]: endpoint } }));
  },
}));

/** A channel is usable when the browser holds a key or the server has env credentials. */
export function channelReady(
  state: Pick<EndpointState, 'endpoints' | 'health'>,
  channel: Channel,
): boolean {
  return hasKey(state.endpoints[channel]) || state.health[channel];
}

/**
 * The stored key exists but the vault is locked, so it reads as an empty
 * string. `channelReady` already answers false in that case; this tells the
 * caller *why* it is false, so the chat can point at the unlock field instead
 * of offering a retrieval-only answer as if no key had ever been saved.
 *
 * A server-side key still wins: a deployment with env credentials does not
 * need the browser vault, and its health flag keeps `channelReady` true.
 */
export function needsVaultUnlock(
  state: Pick<EndpointState, 'endpoints' | 'health'>,
  channel: Channel,
): boolean {
  return state.endpoints[channel]?.sealed === true && !channelReady(state, channel);
}
