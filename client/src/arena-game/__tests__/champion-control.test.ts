/**
 * Arena 2.0 P2 — champion player-control commands (basic-attack combo +
 * lane-switch). Covers the pure combo/lane logic AND the load-bearing
 * determinism guarantee: piloting the champion with the new commands replays
 * digest-identically (they are replay-safe), and — implicitly, via the
 * untouched stability suite — Arena 1.0 (which never issues them) is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../content';
import {
  applyChampionBasicAttack,
  applyChampionLaneSwitch,
  comboActive,
  comboMultForCount,
  COMBO_MAX,
  COMBO_WINDOW_TICKS,
  LANE_SWITCH_COOLDOWN_TICKS,
} from '../game-engine/commands/champion-control';
import {
  createLiveBattle,
  liveDigest,
  queueChampionBasicAttack,
  queueChampionLaneSwitch,
  stepLiveBattle,
} from '../features/arena/battle-controller';
import { runBattle } from '../game-engine/simulation/run';
import { DEFAULT_DECK_CARD_IDS } from '../services/persistence/save';
import type { BattleState, UnitState } from '../game-engine/simulation/state';

const mkState = (tick: number): BattleState => ({ tick, log: [], phase: 'main' }) as unknown as BattleState;
const mkChampionUnit = (): UnitState =>
  ({
    id: 1,
    team: 'player',
    kind: 'champion',
    contentId: 'champion-titan',
    lane: 0,
    targetId: 5,
    attackCooldownTicks: 10,
    champion: { comboCount: 0, lastBasicAttackTick: -9999, pendingComboMult: null, laneSwitchReadyTick: 0 },
  }) as unknown as UnitState;

describe('comboMultForCount', () => {
  it('scales +18% per combo level and caps at COMBO_MAX', () => {
    expect(comboMultForCount(0)).toBeCloseTo(1.0);
    expect(comboMultForCount(1)).toBeCloseTo(1.18);
    expect(comboMultForCount(COMBO_MAX)).toBeCloseTo(1 + COMBO_MAX * 0.18);
    expect(comboMultForCount(COMBO_MAX + 5)).toBeCloseTo(comboMultForCount(COMBO_MAX));
  });
});

describe('applyChampionBasicAttack', () => {
  it('first tap starts a combo, primes the next strike, and readies the attack', () => {
    const u = mkChampionUnit();
    const r = applyChampionBasicAttack(mkState(100), u);
    expect(r.ok).toBe(true);
    expect(u.champion!.comboCount).toBe(1);
    expect(u.champion!.pendingComboMult).toBeCloseTo(comboMultForCount(1));
    expect(u.attackCooldownTicks).toBe(0);
    expect(u.champion!.lastBasicAttackTick).toBe(100);
  });

  it('rejects taps faster than the minimum gap (rate limit)', () => {
    const u = mkChampionUnit();
    expect(applyChampionBasicAttack(mkState(100), u).ok).toBe(true);
    expect(applyChampionBasicAttack(mkState(101), u).ok).toBe(false); // gap 1 < 3
    expect(u.champion!.comboCount).toBe(1); // unchanged by the rejected tap
  });

  it('chains the combo within the window and resets after it', () => {
    const u = mkChampionUnit();
    applyChampionBasicAttack(mkState(100), u);
    expect(applyChampionBasicAttack(mkState(103), u).ok).toBe(true); // in gap + window
    expect(u.champion!.comboCount).toBe(2);
    // A tap beyond the window restarts the combo at 1.
    expect(applyChampionBasicAttack(mkState(103 + COMBO_WINDOW_TICKS + 1), u).ok).toBe(true);
    expect(u.champion!.comboCount).toBe(1);
  });

  it('caps the combo at COMBO_MAX', () => {
    const u = mkChampionUnit();
    let t = 100;
    for (let i = 0; i < COMBO_MAX + 3; i++) {
      applyChampionBasicAttack(mkState(t), u);
      t += 3; // exactly the min gap, inside the window
    }
    expect(u.champion!.comboCount).toBe(COMBO_MAX);
  });

  it('rejects a non-champion unit', () => {
    const noChamp = { champion: undefined } as unknown as UnitState;
    expect(applyChampionBasicAttack(mkState(1), noChamp).ok).toBe(false);
  });
});

describe('applyChampionLaneSwitch', () => {
  it('flips the lane, drops the target, and sets the cooldown', () => {
    const u = mkChampionUnit(); // lane 0, target 5
    const r = applyChampionLaneSwitch(mkState(50), u);
    expect(r.ok).toBe(true);
    expect(u.lane).toBe(1);
    expect(u.targetId).toBeNull();
    expect(u.champion!.laneSwitchReadyTick).toBe(50 + LANE_SWITCH_COOLDOWN_TICKS);
  });

  it('rejects while on cooldown, allows again after it', () => {
    const u = mkChampionUnit();
    expect(applyChampionLaneSwitch(mkState(50), u).ok).toBe(true);
    expect(applyChampionLaneSwitch(mkState(51), u).ok).toBe(false);
    expect(applyChampionLaneSwitch(mkState(50 + LANE_SWITCH_COOLDOWN_TICKS), u).ok).toBe(true);
    expect(u.lane).toBe(0); // flipped back
  });
});

describe('comboActive', () => {
  it('is true only within the combo window of the last tap', () => {
    expect(comboActive({ lastBasicAttackTick: 100 }, 100 + COMBO_WINDOW_TICKS)).toBe(true);
    expect(comboActive({ lastBasicAttackTick: 100 }, 100 + COMBO_WINDOW_TICKS + 1)).toBe(false);
  });
});

describe('determinism — new commands are replay-safe', () => {
  it('piloting the champion with basic-attack + lane-switch replays digest-identically', () => {
    const live = createLiveBattle(20260724, 'p1', {
      playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
      opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
      playerChampionId: 'champion-titan',
    });
    let basics = 0;
    let switches = 0;
    while (live.state.phase !== 'finished') {
      stepLiveBattle(live, 5);
      if (queueChampionBasicAttack(live).ok) basics++;
      if (live.state.tick % 40 === 0 && queueChampionLaneSwitch(live).ok) switches++;
    }
    expect(basics).toBeGreaterThan(0);
    expect(switches).toBeGreaterThan(0);
    // Re-simulate purely from the recorded command log → same digest/outcome.
    const rerun = runBattle(live.config, live.commandLog, BALANCE);
    expect(rerun.digest).toBe(liveDigest(live));
    expect(rerun.outcome).toEqual(live.state.outcome);
    expect(rerun.invariantViolations).toEqual([]);
  });
});
