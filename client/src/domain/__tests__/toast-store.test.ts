import { beforeEach, describe, expect, it } from 'vitest';

import { XP_PER_SET } from '../xp';
import { announceXp, useToastStore } from '../../state/toast-store';

beforeEach(() => useToastStore.getState().reset());

describe('toast store', () => {
  it('push and dismiss by id', () => {
    const id = useToastStore.getState().push({ kind: 'info', title: 'hello' });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('dismissing one leaves the others', () => {
    const a = useToastStore.getState().push({ kind: 'info', title: 'a' });
    useToastStore.getState().push({ kind: 'pr', title: 'b' });
    useToastStore.getState().dismiss(a);
    expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual(['b']);
  });

  it('reset empties the queue — the sign-out rule', () => {
    useToastStore.getState().push({ kind: 'xp', title: 'x', xp: 10 });
    useToastStore.getState().push({ kind: 'achievement', title: 'y' });
    useToastStore.getState().reset();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('announceXp defaults to the real per-set XP, truncated', () => {
    announceXp(XP_PER_SET);
    const t = useToastStore.getState().toasts[0];
    expect(t.kind).toBe('xp');
    expect(t.xp).toBe(10);
    expect(t.title).toBe('QUEST COMPLETE');

    announceXp(12.9);
    expect(useToastStore.getState().toasts[1].xp).toBe(12);
  });
});
