import { describe, expect, it } from 'vitest';

import {
  CALLOUT_QUICK_CHIPS,
  DEFAULT_CALLOUT_CONFIG,
  calloutHeadline,
  calloutOutcomeCoins,
  calloutResultLine,
  calloutTargetLabel,
  calloutsAvailable,
  clampCalloutStake,
  countedSetsEver,
  isAttachedToSet,
  isCallableMode,
  isLive,
  judgeCallout,
  maxCalloutStake,
  nextCallableSet,
  type CalloutRow,
} from '../callouts';
import type { WorkoutRow } from '../summary';

const row = (set: number, weight: number, reps: number, date = '2026-08-08'): WorkoutRow => ({
  date,
  workout: 'Push 1 - Strength',
  exercise: 'Bench Press',
  set,
  weight,
  reps,
  timestamp: `${date}T10:0${set}:00`,
});

describe('the proposition reads like a human said it', () => {
  it('an ordinary lift', () => {
    expect(calloutTargetLabel({ loadMode: 'external', weightKg: 100, reps: 5 })).toBe('100 KG × 5+');
  });

  it('a bodyweight set never mentions a kilogram', () => {
    const label = calloutTargetLabel({ loadMode: 'bodyweight', weightKg: null, reps: 8 });
    expect(label).toBe('BW × 8+');
    expect(label).not.toContain('0 KG');
  });

  it('a weighted bodyweight set names the ADDED load', () => {
    expect(calloutTargetLabel({ loadMode: 'weighted_bodyweight', weightKg: 10, reps: 5 }))
      .toBe('BW + 10 KG × 5+');
  });

  it('an assisted set subtracts, because assistance is not weight lifted', () => {
    expect(calloutTargetLabel({ loadMode: 'assisted_bodyweight', weightKg: 30, reps: 6 }))
      .toBe('BW − 30 KG × 6+');
  });

  it('renders in the athlete\'s unit, once, so both sides read one bet', () => {
    expect(calloutTargetLabel({ loadMode: 'external', weightKg: 100, reps: 5 }, 'lb'))
      .toBe('220.5 LB × 5+');
  });

  it('a reps-only set is just reps', () => {
    expect(calloutTargetLabel({ loadMode: 'repetition_only', weightKg: null, reps: 20 })).toBe('20+');
  });

  it('duration and distance cannot carry a rep call', () => {
    expect(isCallableMode('duration')).toBe(false);
    expect(isCallableMode('distance')).toBe(false);
    expect(isCallableMode('external')).toBe(true);
    expect(isCallableMode('bodyweight')).toBe(true);
  });
});

/**
 * THESE CASES ARE THE SAME ONES SECTION 12 OF tools/falsify-workout-callouts.mjs
 * ASSERTS AGAINST `callout_judge` IN SQL. The client's copy exists only to warn
 * the athlete before they log; if the two ever disagree, one of these two suites
 * goes red immediately rather than a payout going wrong eventually.
 */
describe('the judge — enough reps AND at least the load', () => {
  const t = { loadMode: 'external' as const, weightKg: 100, reps: 5 };

  it('meeting it exactly is a hit', () => {
    expect(judgeCallout(t, { loadMode: 'external', weightKg: 100, reps: 5 })).toBe('hit');
  });

  it('doing more is a hit', () => {
    expect(judgeCallout(t, { loadMode: 'external', weightKg: 105, reps: 6 })).toBe('hit');
  });

  it('one rep short is a miss', () => {
    expect(judgeCallout(t, { loadMode: 'external', weightKg: 100, reps: 4 })).toBe('miss');
  });

  it('the reps at a lighter load is a miss — the load is part of the bet', () => {
    expect(judgeCallout(t, { loadMode: 'external', weightKg: 60, reps: 12 })).toBe('miss');
  });

  it('bodyweight: reps decide it, and adding weight still counts', () => {
    const bw = { loadMode: 'bodyweight' as const, weightKg: null, reps: 8 };
    expect(judgeCallout(bw, { loadMode: 'bodyweight', weightKg: 0, reps: 8 })).toBe('hit');
    expect(judgeCallout(bw, { loadMode: 'weighted_bodyweight', weightKg: 0, externalLoadKg: 10, reps: 8 }))
      .toBe('hit');
    expect(judgeCallout(bw, { loadMode: 'assisted_bodyweight', weightKg: 0, assistanceKg: 20, reps: 12 }))
      .toBe('miss');
  });

  it('assisted: LESS assistance is more work', () => {
    const as30 = { loadMode: 'assisted_bodyweight' as const, weightKg: 30, reps: 5 };
    expect(judgeCallout(as30, { loadMode: 'assisted_bodyweight', weightKg: 0, assistanceKg: 20, reps: 5 }))
      .toBe('hit');
    expect(judgeCallout(as30, { loadMode: 'assisted_bodyweight', weightKg: 0, assistanceKg: 40, reps: 9 }))
      .toBe('miss');
    expect(judgeCallout(as30, { loadMode: 'bodyweight', weightKg: 0, reps: 5 })).toBe('hit');
  });

  it('weighted: the added kilos have to be there', () => {
    const w10 = { loadMode: 'weighted_bodyweight' as const, weightKg: 10, reps: 5 };
    expect(judgeCallout(w10, { loadMode: 'weighted_bodyweight', weightKg: 0, externalLoadKg: 10, reps: 5 }))
      .toBe('hit');
    expect(judgeCallout(w10, { loadMode: 'weighted_bodyweight', weightKg: 0, externalLoadKg: 5, reps: 9 }))
      .toBe('miss');
  });

  describe('on a PRE-133 row, where the database has no load modes at all', () => {
    it('external still compares the weight', () => {
      expect(judgeCallout(t, { loadMode: null, weightKg: 100, reps: 5 })).toBe('hit');
      expect(judgeCallout(t, { loadMode: null, weightKg: 80, reps: 9 })).toBe('miss');
    });

    it('a 0 kg bodyweight row is judged on its reps, not failed for being 0 kg', () => {
      const bw = { loadMode: 'bodyweight' as const, weightKg: null, reps: 8 };
      expect(judgeCallout(bw, { loadMode: null, weightKg: 0, reps: 8 })).toBe('hit');
      expect(judgeCallout(bw, { loadMode: null, weightKg: 0, reps: 7 })).toBe('miss');
    });

    it('a weighted-bodyweight call still works, because the legacy weight IS the added load', () => {
      const w10 = { loadMode: 'weighted_bodyweight' as const, weightKg: 10, reps: 5 };
      expect(judgeCallout(w10, { loadMode: null, weightKg: 10, reps: 5 })).toBe('hit');
      expect(judgeCallout(w10, { loadMode: null, weightKg: 5, reps: 5 })).toBe('miss');
    });
  });
});

describe('the reveal is a reveal, not a gate', () => {
  const base = { enabled: true, countedSetsEver: 50, friendCount: 2 };

  it('appears once there is enough training for the question to mean anything', () => {
    expect(calloutsAvailable(base)).toBe(true);
  });

  it('stays away while the athlete has barely trained', () => {
    expect(calloutsAvailable({ ...base, countedSetsEver: 3 })).toBe(false);
  });

  it('stays away with nobody to call out', () => {
    expect(calloutsAvailable({ ...base, friendCount: 0 })).toBe(false);
  });

  it('the setting switches it off outright', () => {
    expect(calloutsAvailable({ ...base, enabled: false })).toBe(false);
  });

  it('counts only counted sets', () => {
    expect(countedSetsEver([row(1, 100, 5), row(2, 100, 0), row(3, 0, 8)])).toBe(2);
    expect(countedSetsEver(undefined)).toBe(0);
  });
});

describe('which set a call attaches to', () => {
  it('the first one not yet logged — the set they are about to do', () => {
    expect(nextCallableSet([row(1, 100, 5)], 4)).toBe(2);
  });

  it('set 1 when nothing is logged', () => {
    expect(nextCallableSet([], 3)).toBe(1);
  });

  it('a gap is offered before the end, because that is the next real one', () => {
    expect(nextCallableSet([row(1, 100, 5), row(3, 100, 5)], 4)).toBe(2);
  });

  it('null when the exercise is finished — there is nothing left to call', () => {
    expect(nextCallableSet([row(1, 100, 5), row(2, 100, 5)], 2)).toBeNull();
  });

  it('a 0-rep row does not count as logged', () => {
    expect(nextCallableSet([row(1, 100, 0)], 3)).toBe(1);
  });
});

describe('the stake can never be one the server would refuse', () => {
  const cfg = DEFAULT_CALLOUT_CONFIG;

  it('clamps to the wallet', () => {
    expect(maxCalloutStake(40, cfg)).toBe(40);
    expect(clampCalloutStake(100, 40, cfg)).toBe(40);
  });

  it('clamps to the configured ceiling', () => {
    expect(maxCalloutStake(100000, cfg)).toBe(cfg.max_stake);
  });

  it('returns 0 when the athlete cannot even meet the minimum', () => {
    expect(clampCalloutStake(50, 2, cfg)).toBe(0);
  });

  it('the quick rail is a subset a thumb can hit, not the whole ladder', () => {
    expect([...CALLOUT_QUICK_CHIPS]).toEqual([25, 50, 100, 250]);
  });
});

const callout = (over: Partial<CalloutRow> = {}): CalloutRow => ({
  id: 'c1',
  athlete_id: 'a',
  opponent_id: 'b',
  initiated_by: 'a',
  workout_date: '2026-08-08',
  workout_name: 'Push 1 - Strength',
  exercise: 'Bench Press',
  set_no: 1,
  target_reps: 5,
  target_load_mode: 'external',
  target_weight_kg: 100,
  target_label: '100 KG × 5+',
  stake: 50,
  pot: 100,
  hit_probability: 0.61,
  odds_model_version: 'callout-odds-v1',
  odds_evidence: null,
  status: 'accepted',
  result: null,
  actual_reps: null,
  actual_weight_kg: null,
  actual_load_mode: null,
  dispute_reason: null,
  athlete_calloff_at: null,
  opponent_calloff_at: null,
  created_at: '2026-08-08T10:00:00Z',
  expires_at: '2026-08-08T16:00:00Z',
  accepted_at: '2026-08-08T10:01:00Z',
  set_logged_at: null,
  verified_at: null,
  settled_at: null,
  i_am_athlete: true,
  athlete_name: 'Tyson',
  opponent_name: 'Jesse',
  ...over,
});

describe('the words are gym words', () => {
  it('the athlete waiting on an answer', () => {
    expect(calloutHeadline(callout({ status: 'offered' }))).toBe('WAITING ON JESSE');
  });

  it('the opponent seeing the offer', () => {
    expect(calloutHeadline(callout({ status: 'offered', i_am_athlete: false }))).toBe('TYSON CALLED IT');
  });

  it('live, from the athlete\'s side', () => {
    expect(calloutHeadline(callout({ status: 'accepted' }))).toBe('JESSE DOUBTS YOU');
  });

  it('the verification prompt', () => {
    expect(calloutHeadline(callout({ status: 'awaiting_verification', i_am_athlete: false })))
      .toBe('VERIFY TYSON');
  });

  it('a hit and a miss', () => {
    expect(calloutHeadline(callout({ status: 'settled', result: 'hit' }))).toBe('CALL HIT');
    expect(calloutHeadline(callout({ status: 'settled', result: 'miss' }))).toBe('CALL MISSED');
  });

  it('nobody attempted it, and nobody won', () => {
    expect(calloutHeadline(callout({ status: 'expired' }))).toBe('CALLED OFF — NOT ATTEMPTED');
    expect(calloutHeadline(callout({ status: 'expired', accepted_at: null }))).toBe('OFFER EXPIRED');
  });

  it('no financial vocabulary anywhere in the copy', () => {
    const all = (['offered', 'accepted', 'awaiting_verification', 'settled', 'declined',
      'cancelled', 'disputed', 'expired'] as const)
      .flatMap((status) => [
        calloutHeadline(callout({ status, result: 'hit' })),
        calloutHeadline(callout({ status, result: 'miss', i_am_athlete: false })),
      ])
      .join(' ');
    for (const banned of ['PROPOSITION', 'CONTRACT', 'INSTRUMENT', 'MARKET', 'POSITION', 'ODDS', 'BET']) {
      expect(all).not.toContain(banned);
    }
  });
});

describe('what the ledger did, from the reader\'s side', () => {
  // A win is the POT and a loss is the STAKE, on purpose: that is what actually
  // moved. The loser's coins left at acceptance; the winner receives the whole
  // escrow in one row. Netting it would disagree with the coin ledger screen.
  it('the athlete wins the pot on a hit', () => {
    expect(calloutOutcomeCoins(callout({ status: 'settled', result: 'hit' }))).toBe(100);
  });

  it('the athlete loses their stake on a miss', () => {
    expect(calloutOutcomeCoins(callout({ status: 'settled', result: 'miss' }))).toBe(-50);
  });

  it('the doubter wins the pot on a miss', () => {
    expect(calloutOutcomeCoins(callout({ status: 'settled', result: 'miss', i_am_athlete: false })))
      .toBe(100);
  });

  it('a call off is a wash, and a wash is a real answer', () => {
    expect(calloutOutcomeCoins(callout({ status: 'expired' }))).toBe(0);
    expect(calloutOutcomeCoins(callout({ status: 'cancelled' }))).toBe(0);
  });
});

describe('the loser\'s line is concise and states the gap', () => {
  it('says what was needed', () => {
    expect(calloutResultLine(callout({ result: 'miss', actual_reps: 4, actual_weight_kg: 100 })))
      .toBe('100 KG × 4 · NEEDED 5');
  });

  it('a hit just states the set', () => {
    expect(calloutResultLine(callout({ result: 'hit', actual_reps: 6, actual_weight_kg: 100 })))
      .toBe('100 KG × 6');
  });

  it('nothing logged yet, nothing to say', () => {
    expect(calloutResultLine(callout())).toBeNull();
  });
});

describe('status helpers', () => {
  it('a disputed call is live but no longer attached to a set row', () => {
    expect(isLive('disputed')).toBe(true);
    expect(isAttachedToSet('disputed')).toBe(false);
  });

  it('terminal states are not live', () => {
    for (const s of ['settled', 'declined', 'cancelled', 'expired'] as const) {
      expect(isLive(s)).toBe(false);
    }
  });
});
