import { describe, expect, it } from 'vitest';

import {
  STREAK_MILESTONES,
  challengeHistory,
  confidenceOf,
  winStreak,
} from '../challenge-progression';
import type { ForgeChallenge } from '../forge-challenge';

/**
 * WAGER PROGRESSION — tension without chance.
 *
 * The property every one of these protects: nothing here is random, and
 * nothing here punishes an athlete for training. A draw does not break a
 * streak; a loss costs coins and nothing else; confidence is a BAND derived
 * from real scores, never a percentage on a contest decided by future
 * training.
 */

const ME = 'me';
const THEM = 'them';

/** The escrow follows the stake unless a case overrides it explicitly — see
 *  the note in forge-challenge.test.ts. */
const at = (over: Partial<ForgeChallenge>): ForgeChallenge => {
  const stake = over.stake ?? 50;
  return {
  id: 'c',
  challenge_type: 'cardio_minutes',
  metric_key: null,
  duration_days: 7,
  stake,
  status: 'settled',
  created_at: '2026-08-01T00:00:00Z',
  expires_at: '2026-08-08T00:00:00Z',
  accepted_at: '2026-08-01T00:00:00Z',
  starts_at: '2026-08-01T00:00:00Z',
  ends_at: '2026-08-07T23:59:59Z',
  settled_at: '2026-08-08T00:00:00Z',
  winner_id: ME,
  outcome: 'winner',
  result_note: null,
  rematch_of: null,
  challenger_id: ME,
  opponent_id: THEM,
  i_am_challenger: true,
  challenger_name: 'Tyson',
  opponent_name: 'Jesse',
  challenger_baseline: 0,
  opponent_baseline: 0,
  challenger_current: { value: 0 },
  opponent_current: { value: 0 },
  disputed: false,
  current_stake: stake,
  pot: stake * 2,
  raises_accepted: 0,
  last_raise_at: null,
  leader_id: null,
  support_closes_at: null,
  spectators_enabled: true,
  challenger_escrowed: stake,
  opponent_escrowed: stake,
  challenger_last_session: null,
  opponent_last_session: null,
  pending_offer: null,
  raise_state: null,
  support_challenger: 0,
  support_opponent: 0,
  supporter_count: 0,
  ...over,
  };
};

const won = (id: string, day: number, stake = 50) =>
  at({ id, stake, winner_id: ME, outcome: 'winner', settled_at: `2026-08-${String(day).padStart(2, '0')}T00:00:00Z` });
const lost = (id: string, day: number, stake = 50) =>
  at({ id, stake, winner_id: THEM, outcome: 'winner', settled_at: `2026-08-${String(day).padStart(2, '0')}T00:00:00Z` });
const drew = (id: string, day: number, stake = 50) =>
  at({ id, stake, winner_id: null, outcome: 'draw', settled_at: `2026-08-${String(day).padStart(2, '0')}T00:00:00Z` });

describe('win streak', () => {
  it('counts consecutive wins ending at the latest challenge', () => {
    const s = winStreak([won('1', 1), won('2', 2), won('3', 3)], ME);
    expect(s.current).toBe(3);
    expect(s.best).toBe(3);
  });

  it('A DRAW DOES NOT BREAK IT — and does not extend it', () => {
    // Punishing a draw would teach athletes to avoid evenly matched
    // opponents, which is exactly the competition worth having.
    const s = winStreak([won('1', 1), drew('2', 2), won('3', 3)], ME);
    expect(s.current).toBe(2);
  });

  it('a LOSS is the only thing that resets it', () => {
    const s = winStreak([won('1', 1), won('2', 2), lost('3', 3), won('4', 4)], ME);
    expect(s.current).toBe(1);
    expect(s.best).toBe(2);
  });

  it('remembers the best run even after it ends', () => {
    const s = winStreak([won('1', 1), won('2', 2), won('3', 3), lost('4', 4)], ME);
    expect(s.current).toBe(0);
    expect(s.best).toBe(3);
  });

  it('points at the next milestone, and how far it is', () => {
    const s = winStreak([won('1', 1), won('2', 2)], ME);
    expect(s.nextMilestone).toBe(3);
    expect(s.toNext).toBe(1);
  });

  it('the FIRST milestone is reachable from a standing start', () => {
    // A target you cannot see from zero is a wall, not a target.
    expect(STREAK_MILESTONES[0]).toBeLessThanOrEqual(3);
    const s = winStreak([], ME);
    expect(s.toNext).toBe(STREAK_MILESTONES[0]);
  });

  it('past the last milestone there is nothing left to chase, and it says so', () => {
    const rows = Array.from({ length: 21 }, (_, i) => won(String(i), (i % 28) + 1));
    const s = winStreak(rows, ME);
    expect(s.current).toBe(21);
    expect(s.nextMilestone).toBeNull();
    expect(s.toNext).toBeNull();
  });

  it('unsettled challenges are not results', () => {
    const s = winStreak([won('1', 1), at({ id: '2', status: 'active', settled_at: null })], ME);
    expect(s.current).toBe(1);
  });

  it('reads from the OPPONENT’s seat correctly', () => {
    expect(winStreak([won('1', 1), won('2', 2)], THEM).current).toBe(0);
    expect(winStreak([lost('1', 1), lost('2', 2)], THEM).current).toBe(2);
  });
});

describe('history', () => {
  it('keeps the last five, newest first', () => {
    const rows = [won('1', 1), lost('2', 2), won('3', 3), drew('4', 4), won('5', 5), lost('6', 6)];
    const h = challengeHistory(rows, ME);
    expect(h.recent).toHaveLength(5);
    expect(h.recent[0].id).toBe('6');
    expect(h.recent[0].result).toBe('lost');
  });

  it('tracks the biggest single win', () => {
    const h = challengeHistory([won('1', 1, 10), won('2', 2, 50), won('3', 3, 25)], ME);
    expect(h.biggestWin).toBe(50);
  });

  it('net coins CAN BE NEGATIVE and is reported as-is', () => {
    // A record that only ever counts up is not a record.
    const h = challengeHistory([won('1', 1, 10), lost('2', 2, 50)], ME);
    expect(h.netCoins).toBe(-40);
  });

  it('a draw moves no coins', () => {
    const h = challengeHistory([drew('1', 1, 50)], ME);
    expect(h.netCoins).toBe(0);
    expect(h.biggestWin).toBe(0);
  });

  it('names the opponent from my point of view', () => {
    const h = challengeHistory([won('1', 1)], ME);
    expect(h.recent[0].opponent).toBe('Jesse');
    const theirs = challengeHistory([won('1', 1)], THEM);
    expect(theirs.recent[0].opponent).toBe('Tyson');
  });

  it('an athlete with no settled challenges gets honest zeros', () => {
    const h = challengeHistory([], ME);
    expect(h).toEqual({ recent: [], biggestWin: 0, netCoins: 0, totalSettled: 0 });
  });
});

describe('confidence is a band, never a number', () => {
  const live = (mine: number, theirs: number) =>
    at({
      status: 'active',
      settled_at: null,
      winner_id: null,
      outcome: null,
      challenger_current: { value: mine },
      opponent_current: { value: theirs },
    });

  it('nothing logged on either side is EVEN, not a lead', () => {
    expect(confidenceOf(live(0, 0), ME).band).toBe('even');
  });

  it('a wide lead is commanding', () => {
    expect(confidenceOf(live(100, 20), ME).band).toBe('commanding');
  });

  it('a narrow lead is only a slight advantage', () => {
    expect(confidenceOf(live(102, 100), ME).band).toBe('even');
    expect(confidenceOf(live(120, 100), ME).band).toBe('ahead');
  });

  it('being behind is never framed as losing', () => {
    const c = confidenceOf(live(20, 100), ME);
    expect(c.band).toBe('chasing');
    expect(c.label).not.toMatch(/lose|losing|fail/i);
    expect(c.note).toMatch(/closes the gap/i);
  });

  it('the gap is judged RELATIVE to the scores, not in absolute points', () => {
    // 2 points apart means something different at 5 than at 200.
    expect(confidenceOf(live(5, 3), ME).band).toBe('commanding');
    expect(confidenceOf(live(202, 200), ME).band).toBe('even');
  });

  it('never exposes a percentage anywhere in its copy', () => {
    for (const [a, b] of [[0, 0], [100, 20], [20, 100], [51, 50]]) {
      const c = confidenceOf(live(a, b), ME);
      expect(`${c.label} ${c.note}`).not.toMatch(/\d+\s*%/);
    }
  });

  it('is symmetric — the opponent sees the mirror image', () => {
    const c = live(100, 20);
    expect(confidenceOf(c, ME).band).toBe('commanding');
    const flipped = { ...c, i_am_challenger: false };
    expect(confidenceOf(flipped, THEM).band).toBe('chasing');
  });
});

// `outcomesFor` and its two tests moved to domain/forge-duel.ts's AT_RISK in
// 2026-08-08's duel pass. It said the same thing as the new grid, and two
// copies of "what a loss does not touch" is exactly the drift this codebase
// keeps learning about the hard way.
