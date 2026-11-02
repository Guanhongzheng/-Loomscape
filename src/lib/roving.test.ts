import { describe, expect, it } from 'vitest';
import { nextTabIndex } from '@/lib/roving';

describe('nextTabIndex', () => {
  it('moves right and wraps at the end', () => {
    expect(nextTabIndex(0, 3, 'ArrowRight')).toBe(1);
    expect(nextTabIndex(2, 3, 'ArrowRight')).toBe(0);
  });

  it('moves left and wraps at the start', () => {
    expect(nextTabIndex(2, 3, 'ArrowLeft')).toBe(1);
    expect(nextTabIndex(0, 3, 'ArrowLeft')).toBe(2);
  });

  it('accepts the vertical arrows, which some keyboards use', () => {
    expect(nextTabIndex(0, 3, 'ArrowDown')).toBe(1);
    expect(nextTabIndex(0, 3, 'ArrowUp')).toBe(2);
  });

  it('jumps to the ends with Home and End', () => {
    expect(nextTabIndex(1, 3, 'Home')).toBe(0);
    expect(nextTabIndex(1, 3, 'End')).toBe(2);
  });

  it('leaves anything else alone, so typing in the group is harmless', () => {
    expect(nextTabIndex(1, 3, 'a')).toBe(1);
    expect(nextTabIndex(1, 3, 'Enter')).toBe(1);
    expect(nextTabIndex(1, 3, 'Tab')).toBe(1);
  });

  it('survives an empty group instead of dividing by zero', () => {
    expect(nextTabIndex(0, 0, 'ArrowRight')).toBe(0);
  });
});
