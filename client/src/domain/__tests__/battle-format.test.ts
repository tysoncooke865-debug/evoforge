import { describe, expect, it } from 'vitest';

import { formatLabel, isFinished, isLive, newestFirst, normalizeCode, splitBattles } from '../battle/format';

const m = (id: string, status: string, created_at: string) => ({ id, status, created_at });

describe('formatLabel', () => {
  it('names each shipped format — the hub used to call every match a Blitz', () => {
    expect(formatLabel('blitz')).toBe('Friendly Blitz');
    expect(formatLabel('volume_duel')).toBe('Volume Duel');
    expect(formatLabel('heads_or_tails')).toBe('Heads or Tails');
  });
  it('an unknown format falls back rather than rendering blank', () => {
    expect(formatLabel('future_mode')).toBe('Friendly Blitz');
  });
});

describe('isLive / isFinished', () => {
  it('matched, active and judging all need the athlete', () => {
    for (const s of ['matched', 'active', 'judging']) {
      expect(isLive(m('x', s, '2026-07-13'))).toBe(true);
    }
  });
  it('inviting is NOT live — nobody has joined yet', () => {
    expect(isLive(m('x', 'inviting', '2026-07-13'))).toBe(false);
  });
  it('settled and abandoned are finished', () => {
    expect(isFinished(m('x', 'settled', '2026-07-13'))).toBe(true);
    expect(isFinished(m('x', 'abandoned', '2026-07-13'))).toBe(true);
  });
});

describe('normalizeCode — one gate for both code namespaces', () => {
  it('trims and uppercases', () => {
    expect(normalizeCode(' abc123 ')).toBe('ABC123');
  });
  it('anything but exactly six characters is null', () => {
    expect(normalizeCode('abc')).toBeNull();
    expect(normalizeCode('')).toBeNull();
    expect(normalizeCode('ABCDEFG')).toBeNull();
  });
});

describe('newestFirst — the hub and GAME LOG share one ordering', () => {
  it('sorts descending by created_at and never mutates the input', () => {
    const input = [m('old', 'settled', '2026-07-01'), m('new', 'settled', '2026-07-12'), m('mid', 'settled', '2026-07-05')];
    const copy = [...input];
    const sorted = newestFirst(input);
    expect(sorted.map((x) => x.id)).toEqual(['new', 'mid', 'old']);
    expect(input).toEqual(copy);
    expect(sorted).not.toBe(input);
  });
});

describe('splitBattles', () => {
  const matches = [
    m('a', 'settled', '2026-07-01'),
    m('b', 'active', '2026-07-10'),
    m('c', 'inviting', '2026-07-12'),
    m('d', 'judging', '2026-07-11'),
    m('e', 'abandoned', '2026-07-05'),
  ];

  it('buckets by status, newest first within each', () => {
    const s = splitBattles(matches);
    expect(s.live.map((x) => x.id)).toEqual(['d', 'b']); // 07-11 before 07-10
    expect(s.invites.map((x) => x.id)).toEqual(['c']);
    expect(s.history.map((x) => x.id)).toEqual(['e', 'a']);
  });

  it('every match lands in exactly one bucket', () => {
    const s = splitBattles(matches);
    expect(s.live.length + s.invites.length + s.history.length).toBe(matches.length);
  });

  it('an unknown status falls to history, never vanishes', () => {
    const s = splitBattles([m('z', 'some_future_status', '2026-07-13')]);
    expect(s.history.map((x) => x.id)).toEqual(['z']);
  });

  it('no matches → three empty buckets, not a throw', () => {
    expect(splitBattles([])).toEqual({ live: [], invites: [], history: [] });
  });
});
