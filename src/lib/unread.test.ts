import { beforeEach, describe, expect, it } from 'vitest';
import { unreadTotal, useUnread } from '@/lib/unread';

describe('unread store', () => {
  beforeEach(() => {
    useUnread.getState().reset();
  });

  it('treats existing history as read on first sight', () => {
    useUnread.getState().known('grp_1', 1_000);
    const state = useUnread.getState();
    expect(state.seenAt.grp_1).toBe(1_000);
    expect(state.counts.grp_1 ?? 0).toBe(0);
  });

  it('does not move the watermark when a conversation is seen again', () => {
    useUnread.getState().known('grp_1', 1_000);
    useUnread.getState().known('grp_1', 5_000);
    expect(useUnread.getState().seenAt.grp_1).toBe(1_000);
  });

  it('accumulates live arrivals and clears them when opened', () => {
    useUnread.getState().known('grp_1', 1_000);
    useUnread.getState().bump('grp_1');
    useUnread.getState().bump('grp_1');
    expect(useUnread.getState().counts.grp_1).toBe(2);

    useUnread.getState().markRead('grp_1', 2_000);
    expect(useUnread.getState().counts.grp_1).toBe(0);
    expect(useUnread.getState().seenAt.grp_1).toBe(2_000);
  });

  it('never counts below zero', () => {
    useUnread.getState().setCount('grp_1', -3);
    expect(useUnread.getState().counts.grp_1).toBe(0);
  });

  it('sums every conversation for the dock badge', () => {
    useUnread.getState().setCount('grp_1', 2);
    useUnread.getState().setCount('grp_2', 3);
    expect(unreadTotal(useUnread.getState())).toBe(5);
  });

  it('tracks the announcement version separately from messages', () => {
    useUnread.getState().known('grp_1', 1_000, 800);
    expect(useUnread.getState().announcementSeen.grp_1).toBe(800);

    useUnread.getState().markAnnouncementSeen('grp_1', 1_500);
    expect(useUnread.getState().announcementSeen.grp_1).toBe(1_500);
    expect(useUnread.getState().counts.grp_1 ?? 0).toBe(0);
  });

  it('resets every map', () => {
    useUnread.getState().bump('grp_1');
    useUnread.getState().markAnnouncementSeen('grp_1', 10);
    useUnread.getState().reset();
    const state = useUnread.getState();
    expect(state.counts).toEqual({});
    expect(state.seenAt).toEqual({});
    expect(state.announcementSeen).toEqual({});
  });
});
