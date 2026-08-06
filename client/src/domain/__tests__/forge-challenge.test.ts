import { describe, expect, it } from 'vitest';

import {
  CHALLENGE_INFO,
  bucketChallenges,
  challengeDay,
  challengeProgress,
  challengeRecord,
  isExpired,
  isSettleable,
  leaderOf,
  myCoinDelta,
  myResult,
  sideLabel,
  sideScore,
  sidesOf,
  type ForgeChallenge,
} from '../forge-challenge';

/**
 * FORGE CHALLENGES, client side.
 *
 * The SERVER decides winners (migrations 139-142) and is falsified in SQL
 * against production. These pin the presentation — the numbers an athlete
 * reads while a wager is live, and the record they read afterwards. A
 * percentage that disagrees with the settlement is a trust failure even when
 * the coins moved correctly.
 */

const ME = 'me-uuid';
const THEM = 'them-uuid';

const base: ForgeChallenge = {
  id: 'c1',
  challenge_type: 'most_improved_lift',
  metric_key: 'Barbell Bench Press (Strength)',
  duration_days: 14,
  stake: 50,
  status: 'active',
  created_at: '2026-08-01T00:00:00Z',
  expires_at: '2026-08-08T00:00:00Z',
  accepted_at: '2026-08-01T00:00:00Z',
  starts_at: '2026-08-01T00:00:00Z',
  ends_at: '2026-08-14T23:59:59Z',
  settled_at: null,
  winner_id: null,
  outcome: null,
  result_note: null,
  rematch_of: null,
  challenger_id: ME,
  opponent_id: THEM,
  i_am_challenger: true,
  challenger_name: 'Tyson',
  opponent_name: 'Jesse',
  challenger_baseline: 76,
  opponent_baseline: 100,
  challenger_current: { value: 82, unit: 'kg', measured: true },
  opponent_current: { value: 105.2, unit: 'kg', measured: true },
  disputed: false,
};

const at = (over: Partial<ForgeChallenge>): ForgeChallenge => ({ ...base, ...over });

describe('most improved lift', () => {
  it('scores PERCENTAGE improvement, matching the brief', () => {
    // 76 → 82 is +6 kg / +7.9%
    expect(sideScore(base, 'challenger')).toBe(7.9);
    expect(sideLabel(base, 'challenger')).toBe('+7.9%');
  });

  it('the lighter athlete is not punished for having less to add', () => {
    // +6 kg on 76 beats +5.2 kg on 100, because percentage is the comparison.
    expect(sideScore(base, 'challenger')).toBeGreaterThan(sideScore(base, 'opponent'));
    expect(leaderOf(base)).toBe('challenger');
  });

  it('no baseline is 0, never infinity', () => {
    const c = at({ challenger_baseline: 0, challenger_current: { value: 60 } });
    expect(sideScore(c, 'challenger')).toBe(0);
    const n = at({ challenger_baseline: null, challenger_current: { value: 60 } });
    expect(sideScore(n, 'challenger')).toBe(0);
  });

  it('going backwards is negative, and reads as negative', () => {
    const c = at({ challenger_baseline: 100, challenger_current: { value: 90 } });
    expect(sideScore(c, 'challenger')).toBe(-10);
    expect(sideLabel(c, 'challenger')).toBe('-10.0%');
  });
});

describe('consistency and cardio', () => {
  it('consistency compares raw days', () => {
    const c = at({
      challenge_type: 'training_consistency',
      metric_key: null,
      challenger_current: { value: 5, unit: 'days', scheduled: 6 },
      opponent_current: { value: 4, unit: 'days', scheduled: 3 },
    });
    expect(sideScore(c, 'challenger')).toBe(5);
    expect(sideLabel(c, 'challenger')).toBe('5 days');
    // Judged on DAYS, so the athlete with the lighter schedule gains no edge.
    expect(leaderOf(c)).toBe('challenger');
  });

  it('cardio compares minutes', () => {
    const c = at({
      challenge_type: 'cardio_minutes',
      metric_key: null,
      challenger_current: { value: 120, unit: 'min' },
      opponent_current: { value: 200, unit: 'min' },
    });
    expect(sideLabel(c, 'opponent')).toBe('200 min');
    expect(leaderOf(c)).toBe('opponent');
  });

  it('the baseline is irrelevant to a counting challenge', () => {
    const c = at({
      challenge_type: 'cardio_minutes',
      metric_key: null,
      challenger_baseline: 999,
      challenger_current: { value: 30 },
    });
    expect(sideScore(c, 'challenger')).toBe(30);
  });
});

describe('a tie is a tie', () => {
  it('equal scores read as tied, not as a challenger win', () => {
    const c = at({ challenger_baseline: 100, opponent_baseline: 50,
                   challenger_current: { value: 110 }, opponent_current: { value: 55 } });
    expect(sideScore(c, 'challenger')).toBe(sideScore(c, 'opponent'));
    expect(leaderOf(c)).toBe('tied');
  });
});

describe('the clock', () => {
  it('DAY 8 OF 14', () => {
    expect(challengeDay(base, '2026-08-08')).toEqual({ day: 8, of: 14 });
  });

  it('day one is 1, never 0', () => {
    expect(challengeDay(base, '2026-08-01').day).toBe(1);
  });

  it('never runs past the end', () => {
    expect(challengeDay(base, '2026-09-01')).toEqual({ day: 14, of: 14 });
    expect(challengeProgress(base, '2026-09-01')).toBe(1);
  });

  it('an unaccepted challenge has no day yet', () => {
    expect(challengeDay(at({ starts_at: null }), '2026-08-08').day).toBe(0);
  });
});

describe('results and coins', () => {
  it('a win pays the opponent’s stake', () => {
    const c = at({ status: 'settled', outcome: 'winner', winner_id: ME });
    expect(myResult(c, ME)).toBe('won');
    expect(myCoinDelta(c, ME)).toBe(50);
    expect(myResult(c, THEM)).toBe('lost');
    expect(myCoinDelta(c, THEM)).toBe(-50);
  });

  it('a DRAW is never a loss — the stake comes back', () => {
    const c = at({ status: 'settled', outcome: 'draw', winner_id: null });
    expect(myResult(c, ME)).toBe('drew');
    expect(myCoinDelta(c, ME)).toBe(0);
    expect(myCoinDelta(c, THEM)).toBe(0);
  });

  it('an unsettled challenge has no result and moves no coins', () => {
    expect(myResult(base, ME)).toBeNull();
    expect(myCoinDelta(base, ME)).toBe(0);
  });

  it('the record counts every outcome honestly', () => {
    const rows = [
      at({ id: '1', status: 'settled', outcome: 'winner', winner_id: ME, stake: 50 }),
      at({ id: '2', status: 'settled', outcome: 'winner', winner_id: ME, stake: 25 }),
      at({ id: '3', status: 'settled', outcome: 'winner', winner_id: THEM, stake: 10 }),
      at({ id: '4', status: 'settled', outcome: 'draw', winner_id: null, stake: 10 }),
      at({ id: '5', status: 'active' }),
    ];
    expect(challengeRecord(rows, ME)).toEqual({ wins: 2, losses: 1, draws: 1, coinsWon: 75 });
  });
});

describe('buckets', () => {
  it('an invite TO me is incoming; one FROM me is sent', () => {
    const incoming = at({ id: 'i', status: 'pending', challenger_id: THEM, opponent_id: ME, i_am_challenger: false });
    const sent = at({ id: 's', status: 'pending' });
    const b = bucketChallenges([incoming, sent], ME);
    expect(b.incoming.map((c) => c.id)).toEqual(['i']);
    expect(b.sent.map((c) => c.id)).toEqual(['s']);
  });

  it('a disputed challenge stays with the ACTIVE ones — it still needs attention', () => {
    const b = bucketChallenges([at({ id: 'd', status: 'disputed' })], ME);
    expect(b.active.map((c) => c.id)).toEqual(['d']);
    expect(b.finished).toHaveLength(0);
  });

  it('settled, declined, expired and cancelled are all finished', () => {
    const rows = (['settled', 'declined', 'expired', 'cancelled'] as const).map((s, i) =>
      at({ id: String(i), status: s })
    );
    expect(bucketChallenges(rows, ME).finished).toHaveLength(4);
  });
});

describe('expiry and settleability', () => {
  const now = Date.parse('2026-08-10T00:00:00Z');

  it('a pending invite past its expiry is expired', () => {
    expect(isExpired(at({ status: 'pending', expires_at: '2026-08-09T00:00:00Z' }), now)).toBe(true);
    expect(isExpired(at({ status: 'pending', expires_at: '2026-08-11T00:00:00Z' }), now)).toBe(false);
  });

  it('only a PENDING challenge can expire', () => {
    expect(isExpired(at({ status: 'active', expires_at: '2020-01-01T00:00:00Z' }), now)).toBe(false);
  });

  it('a challenge settles only once its window has closed', () => {
    expect(isSettleable(at({ ends_at: '2026-08-09T00:00:00Z' }), now)).toBe(true);
    expect(isSettleable(at({ ends_at: '2026-08-20T00:00:00Z' }), now)).toBe(false);
  });

  it('a DISPUTED challenge never settles from the UI', () => {
    // The server refuses too; this stops the button existing in the first place.
    expect(isSettleable(at({ ends_at: '2026-08-09T00:00:00Z', disputed: true }), now)).toBe(false);
  });

  it('an already-settled challenge is not settleable again', () => {
    expect(isSettleable(at({ status: 'settled', ends_at: '2026-08-09T00:00:00Z' }), now)).toBe(false);
  });
});

describe('point of view', () => {
  it('sides resolve from whichever seat I am in', () => {
    const asChallenger = sidesOf(base);
    expect(asChallenger.myName).toBe('Tyson');
    expect(asChallenger.theirName).toBe('Jesse');
    expect(asChallenger.theirId).toBe(THEM);

    const asOpponent = sidesOf(at({ i_am_challenger: false }));
    expect(asOpponent.myName).toBe('Jesse');
    expect(asOpponent.theirName).toBe('Tyson');
    expect(asOpponent.theirId).toBe(ME);
  });
});

describe('the rules an athlete agrees to', () => {
  it('every type states what counts AND what does not', () => {
    for (const info of Object.values(CHALLENGE_INFO)) {
      expect(info.measures.length).toBeGreaterThan(10);
      expect(info.winner.length).toBeGreaterThan(10);
      expect(info.counts.length).toBeGreaterThan(0);
      expect(info.doesNotCount.length).toBeGreaterThan(0);
    }
  });

  it('an abandoned workout is explicitly excluded from consistency', () => {
    expect(CHALLENGE_INFO.training_consistency.doesNotCount.join(' ')).toMatch(/abandoned/i);
  });
});
