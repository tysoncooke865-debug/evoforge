/**
 * P4 tests — combat-feel systems: the impact-tier table + pure derivations
 * (features/arena/components/impact.ts) and the battle store's transient
 * time dilation (hit-stop / slow-mo). Pure TS, no React. The dilation tests
 * drive the store's real setInterval loop under fake timers, mirroring
 * battle-flow.test.ts, and assert the SIM PACE changed — while replay
 * identity stays byte-equal (dilation delays ticks, never alters them).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBattleStore } from '../features/arena/battle-store';
import {
  attackPose,
  detectFiredAttacks,
  deriveProjectiles,
  shakeOffset,
  spawnScale,
  STRIKE_MS,
  TIER_FX,
  tierForDamage,
} from '../features/arena/components/impact';

const SEED = 4242;

describe('tierForDamage', () => {
  it('maps the live stat table onto the ladder: unit pokes light, champion basics medium, big hits heavy', () => {
    expect(tierForDamage(8)).toBe('light');
    expect(tierForDamage(44)).toBe('light');
    expect(tierForDamage(45)).toBe('medium');
    expect(tierForDamage(90)).toBe('medium');
    expect(tierForDamage(110)).toBe('heavy');
    expect(tierForDamage(320)).toBe('heavy');
  });

  it('the tier table escalates monotonically (each rung hits harder than the last)', () => {
    expect(TIER_FX.light.floaterFontSize).toBeLessThan(TIER_FX.medium.floaterFontSize);
    expect(TIER_FX.medium.floaterFontSize).toBeLessThan(TIER_FX.heavy.floaterFontSize);
    expect(TIER_FX.heavy.shakePx).toBeLessThan(TIER_FX.ultimate.shakePx);
    expect(TIER_FX.ultimate.shakePx).toBeLessThan(TIER_FX.core.shakePx);
    // Light/medium hits must NOT shake or hit-stop — that flattens the ladder.
    expect(TIER_FX.light.shakePx).toBe(0);
    expect(TIER_FX.light.hitStopMs).toBe(0);
    expect(TIER_FX.medium.shakePx).toBe(0);
    expect(TIER_FX.medium.hitStopMs).toBe(0);
  });
});

describe('shakeOffset', () => {
  it('is zero for tiers with no shake, and zero once the shake has run out', () => {
    expect(shakeOffset(10, 'light')).toEqual({ dx: 0, dy: 0 });
    expect(shakeOffset(TIER_FX.core.shakeMs, 'core')).toEqual({ dx: 0, dy: 0 });
    expect(shakeOffset(-5, 'core')).toEqual({ dx: 0, dy: 0 });
  });

  it('moves during the window and decays toward the end', () => {
    const early = shakeOffset(20, 'core');
    const late = shakeOffset(TIER_FX.core.shakeMs - 20, 'core');
    expect(Math.abs(early.dx) + Math.abs(early.dy)).toBeGreaterThan(0);
    expect(Math.hypot(late.dx, late.dy)).toBeLessThan(Math.hypot(early.dx, early.dy) + 1e-9);
    expect(Math.abs(late.dx)).toBeLessThanOrEqual(TIER_FX.core.shakePx);
  });
});

describe('attackPose (procedural character animation)', () => {
  const base = { attackIntervalTicks: 20 };

  it('idle walker: no offset', () => {
    expect(attackPose({ team: 'player', targetId: null, attackCooldownTicks: 0, base }, null)).toEqual({
      offsetY: 0,
      scale: 1,
    });
  });

  it('fighting stance leans FORWARD: up for player (negative y), down for opponent', () => {
    const p = attackPose({ team: 'player', targetId: 9, attackCooldownTicks: 10, base }, null);
    const o = attackPose({ team: 'opponent', targetId: 9, attackCooldownTicks: 10, base }, null);
    expect(p.offsetY).toBeLessThan(0);
    expect(o.offsetY).toBeGreaterThan(0);
  });

  it('anticipation pulls BACK in the last ticks before the hit, deeper as it nears', () => {
    const far = attackPose({ team: 'player', targetId: 9, attackCooldownTicks: 3, base }, null);
    const near = attackPose({ team: 'player', targetId: 9, attackCooldownTicks: 1, base }, null);
    expect(far.offsetY).toBeGreaterThanOrEqual(0); // backward for player = positive y
    expect(near.offsetY).toBeGreaterThan(far.offsetY);
  });

  it('strike lunges forward harder than the stance lean and swells, then eases back within STRIKE_MS', () => {
    const stance = attackPose({ team: 'player', targetId: 9, attackCooldownTicks: 10, base }, null);
    const mid = attackPose({ team: 'player', targetId: 9, attackCooldownTicks: 19, base }, STRIKE_MS * 0.3);
    expect(mid.offsetY).toBeLessThan(stance.offsetY); // further forward (more negative)
    expect(mid.scale).toBeGreaterThan(1);
    const done = attackPose({ team: 'player', targetId: 9, attackCooldownTicks: 19, base }, STRIKE_MS + 1);
    expect(done.scale).toBe(1); // strike expired -> falls back to stance/lean
  });
});

describe('spawnScale', () => {
  it('drops in oversized, squashes on landing, settles at 1', () => {
    expect(spawnScale(0)).toBeCloseTo(1.35);
    expect(spawnScale(3)).toBeCloseTo(1.0);
    expect(spawnScale(4)).toBeCloseTo(0.92);
    expect(spawnScale(8)).toBe(1);
    expect(spawnScale(500)).toBe(1);
    expect(spawnScale(-1)).toBe(1); // pre-spawn nonsense stays neutral
  });
});

describe('detectFiredAttacks + deriveProjectiles', () => {
  it('detects a fired attack as a cooldown that grew back, ignoring dead units and normal countdown', () => {
    const prev = new Map([
      [1, 2],
      [2, 5],
      [3, 1],
    ]);
    const units = [
      { id: 1, alive: true, attackCooldownTicks: 20 }, // 2 -> 20: fired
      { id: 2, alive: true, attackCooldownTicks: 4 }, // counting down
      { id: 3, alive: false, attackCooldownTicks: 20 }, // dead — ignored
      { id: 4, alive: true, attackCooldownTicks: 7 }, // unseen before — not "fired"
    ];
    expect(detectFiredAttacks(units, prev)).toEqual([1]);
  });

  it('builds a projectile only for ranged attackers with a live same-lane unit target', () => {
    const mk = (
      id: number,
      lane: 0 | 1,
      x: number,
      team: 'player' | 'opponent',
      targetId: number | null,
      isRanged: boolean
    ) => [id, { id, lane, x, team, targetId, base: { isRanged } }] as const;
    const units = new Map([
      mk(1, 0, 20, 'player', 9, true), // ranged, target in lane -> shot
      mk(2, 0, 22, 'player', 9, false), // melee -> no shot
      mk(3, 1, 30, 'player', 9, true), // target in OTHER lane -> no shot
      mk(9, 0, 40, 'opponent', null, false), // the target
    ]);
    const shots = deriveProjectiles([1, 2, 3], units);
    expect(shots).toEqual([{ lane: 0, fromX: 20, toX: 40, team: 'player' }]);
  });
});

describe('battle store time dilation (hit-stop / slow-mo)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hit-stop (scale 0) freezes the sim for its duration, then resumes with no catch-up burst', async () => {
    const store = createBattleStore({ current: null as never });
    store.getState().start(SEED, 'p1');
    await vi.advanceTimersByTimeAsync(500);
    const tickBefore = store.getState().live!.state.tick;
    expect(tickBefore).toBeGreaterThanOrEqual(9);

    store.getState().applyTimeDilation(0, 200);
    await vi.advanceTimersByTimeAsync(200);
    expect(store.getState().live!.state.tick).toBe(tickBefore);

    // Resumes at normal pace — ~4 ticks over the next 200ms, not a burst.
    await vi.advanceTimersByTimeAsync(200);
    const after = store.getState().live!.state.tick;
    expect(after - tickBefore).toBeGreaterThanOrEqual(3);
    expect(after - tickBefore).toBeLessThanOrEqual(5);
    store.getState().reset();
  });

  it('slow-mo advances the sim at roughly the requested fraction of real time', async () => {
    const store = createBattleStore({ current: null as never });
    store.getState().start(SEED, 'p1');
    await vi.advanceTimersByTimeAsync(500);
    const tickBefore = store.getState().live!.state.tick;

    store.getState().applyTimeDilation(0.5, 400);
    await vi.advanceTimersByTimeAsync(400);
    const gained = store.getState().live!.state.tick - tickBefore;
    expect(gained).toBeGreaterThanOrEqual(3);
    expect(gained).toBeLessThanOrEqual(5); // ~400ms * 0.5 / 50ms = 4 ticks
    store.getState().reset();
  });

  it('holdForIntro (P9) freezes the sim through a countdown-length hold, then combat begins cleanly', async () => {
    const store = createBattleStore({ current: null as never });
    store.getState().holdForIntro(2450); // idle: no-op, no throw
    store.getState().start(SEED, 'p1');
    store.getState().holdForIntro(2450);
    await vi.advanceTimersByTimeAsync(2450);
    expect(store.getState().live!.state.tick).toBe(0); // frozen through the intro
    await vi.advanceTimersByTimeAsync(500);
    const after = store.getState().live!.state.tick;
    expect(after).toBeGreaterThanOrEqual(9); // ~10 ticks at normal pace, no burst
    expect(after).toBeLessThanOrEqual(11);
    store.getState().reset();
  });

  it('P11 repeated rematches: dilation/hold state never leaks across consecutive battles', async () => {
    const store = createBattleStore({ current: null as never });
    for (let round = 0; round < 3; round++) {
      store.getState().restart(SEED + round, 'p1');
      // Simulate the P9 intro + a mid-battle hit-stop, then leave some of
      // the dilation window UNCONSUMED before restarting — the next battle
      // must start at full speed regardless.
      store.getState().holdForIntro(2450);
      await vi.advanceTimersByTimeAsync(2450);
      expect(store.getState().live!.state.tick).toBe(0);
      await vi.advanceTimersByTimeAsync(500);
      const tick = store.getState().live!.state.tick;
      expect(tick).toBeGreaterThanOrEqual(9);
      expect(tick).toBeLessThanOrEqual(11);
      store.getState().applyTimeDilation(0, 400); // deliberately abandoned mid-hold
      await vi.advanceTimersByTimeAsync(100);
    }
    // A fresh battle right after an abandoned hold runs at normal pace.
    store.getState().restart(SEED + 99, 'p1');
    await vi.advanceTimersByTimeAsync(500);
    expect(store.getState().live!.state.tick).toBeGreaterThanOrEqual(9);
    store.getState().reset();
  });

  it('a slower active dilation is not overridden by a weaker one, durations are capped, and idle stores ignore it', async () => {
    const store = createBattleStore({ current: null as never });
    // Idle: no-op, no throw.
    store.getState().applyTimeDilation(0, 100);

    store.getState().start(SEED, 'p1');
    await vi.advanceTimersByTimeAsync(250);
    const tickBefore = store.getState().live!.state.tick;

    store.getState().applyTimeDilation(0, 200); // hit-stop…
    store.getState().applyTimeDilation(0.9, 5000); // …must NOT be replaced by a gentle slow-mo
    await vi.advanceTimersByTimeAsync(200);
    expect(store.getState().live!.state.tick).toBe(tickBefore);

    // The oversized 5000ms request was capped: within a second we are back
    // to full speed (were the cap broken, 0.9x would linger for seconds).
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().live!.state.tick).toBeGreaterThan(tickBefore + 15);
    store.getState().reset();
  });
});
