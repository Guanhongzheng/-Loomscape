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
