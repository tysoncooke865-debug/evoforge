/**
 * P6 tests — combat-feel effect derivation (features/arena/components/combat-fx.ts).
 * Pure TS: no React, no engine tick loop, no timers. Log entries are built by
 * hand in the exact shapes the engine already writes (see combat.ts, entities/
 * spawn.ts, abilities/champion-abilities.ts) so this suite pins the CONTRACT
 * between the engine's log and the visual layer without re-simulating a battle.
 */
import { describe, expect, it } from 'vitest';
import { colors, pathColor } from '../constants/theme';
import {
  buildUnitLookup,
  deriveCombatSignals,
  deriveCoreHitIntensity,
  latestMatchingHit,
  UnitLookupMap,
} from '../features/arena/components/combat-fx';
import type { BattleLogEntry } from '../game-engine/simulation/state';

function entry(type: string, detail: string, tick = 1): BattleLogEntry {
  return { tick, type, detail };
}

const EMPTY_UNITS: UnitLookupMap = new Map();

describe('deriveCombatSignals — fx (hit/heal/death) entries', () => {
  it('turns a hit entry into a floater AND a hit signal, player-team hit uses the danger color', () => {
    const log = [entry('fx', 'hit|0|42|85|player')];
    const out = deriveCombatSignals(log, 0, EMPTY_UNITS);
    expect(out.nextIndex).toBe(1);
    expect(out.floaters).toEqual([
      { kind: 'hit', lane: 0, x: 42, team: 'player', text: '-85', color: colors.danger, amount: 85 },
    ]);
    // Legacy 5-field entry (pre-P4 records): no target id, not shielded.
    expect(out.hits).toEqual([
      { lane: 0, x: 42, team: 'player', targetId: null, amount: 85, shielded: false },
    ]);
    expect(out.telegraphs).toEqual([]);
    expect(out.spawns).toEqual([]);
  });

  it('P4: parses the extended hit entry (target id + shield flag); shielded hits tint shield-blue', () => {
    const log = [entry('fx', 'hit|0|42|85|player|17|1'), entry('fx', 'hit|1|10|30|opponent|4|0')];
    const out = deriveCombatSignals(log, 0, EMPTY_UNITS);
    expect(out.hits).toEqual([
      { lane: 0, x: 42, team: 'player', targetId: 17, amount: 85, shielded: true },
      { lane: 1, x: 10, team: 'opponent', targetId: 4, amount: 30, shielded: false },
    ]);
    expect(out.floaters[0].color).toBe(colors.shield);
    expect(out.floaters[1].color).toBe(colors.warning);
  });

  it('an opponent-team hit uses the warning color (opponent units taking damage)', () => {
    const log = [entry('fx', 'hit|1|10|30|opponent')];
    const out = deriveCombatSignals(log, 0, EMPTY_UNITS);
    expect(out.floaters[0].color).toBe(colors.warning);
    expect(out.floaters[0].lane).toBe(1);
  });

  it('turns a heal entry into a heal floater (success color), no hit signal', () => {
    const log = [entry('fx', 'heal|0|5|40|player')];
    const out = deriveCombatSignals(log, 0, EMPTY_UNITS);
    expect(out.floaters).toEqual([
      { kind: 'heal', lane: 0, x: 5, team: 'player', text: '+40', color: colors.success, amount: 40 },
    ]);
    expect(out.hits).toEqual([]);
  });

  it('turns a death entry into a death floater ("✕"), team-tinted, no hit signal', () => {
    const log = [entry('fx', 'death|1|88|0|opponent')];
    const out = deriveCombatSignals(log, 0, EMPTY_UNITS);
    expect(out.floaters).toEqual([
      { kind: 'death', lane: 1, x: 88, team: 'opponent', text: '✕', color: colors.opponent, amount: 0 },
    ]);
    expect(out.hits).toEqual([]);
  });

  it('skips a malformed fx entry (non-finite x) without throwing', () => {
    const log = [entry('fx', 'hit|0|not-a-number|85|player')];
    expect(() => deriveCombatSignals(log, 0, EMPTY_UNITS)).not.toThrow();
    expect(deriveCombatSignals(log, 0, EMPTY_UNITS).floaters).toEqual([]);
  });

  it('skips a malformed fx entry (unknown team) without throwing', () => {
    const log = [entry('fx', 'hit|0|10|85|nobody')];
    expect(deriveCombatSignals(log, 0, EMPTY_UNITS).floaters).toEqual([]);
  });

  it('skips an unknown fx kind', () => {
    const log = [entry('fx', 'shove|0|10|5|player')];
    expect(deriveCombatSignals(log, 0, EMPTY_UNITS).floaters).toEqual([]);
  });
});

describe('deriveCombatSignals — ability/ultimate telegraphs', () => {
  const units: UnitLookupMap = buildUnitLookup([
    { id: 5, lane: 0, x: 62, team: 'player' },
    { id: 9, lane: 1, x: 30, team: 'opponent' },
  ]);

  it('resolves a signature ability cast to the caster\'s current position, path color and ability name', () => {
    const log = [entry('ability', 'champion-titan#5 stomped 2 enemies')];
    const out = deriveCombatSignals(log, 0, units);
    expect(out.telegraphs).toEqual([
      { lane: 0, x: 62, team: 'player', tier: 'ability', label: 'Quake Stomp', color: pathColor('titan'), path: 'titan' },
    ]);
  });

  it('resolves an ultimate cast with the ultimate name (tier "ultimate")', () => {
    const log = [entry('ultimate', 'champion-titan#5 smashed 3 enemies')];
    const out = deriveCombatSignals(log, 0, units);
    expect(out.telegraphs).toEqual([
      { lane: 0, x: 62, team: 'player', tier: 'ultimate', label: 'Seismic Smash', color: pathColor('titan'), path: 'titan' },
    ]);
  });

  it('resolves the caster from the opposing team correctly (lane/team follow the unit, not the log order)', () => {
    const log = [entry('ability', 'champion-shredder#9 dashed to recruit#3')];
    const out = deriveCombatSignals(log, 0, units);
    expect(out.telegraphs).toEqual([
      {
        lane: 1,
        x: 30,
        team: 'opponent',
        tier: 'ability',
        label: 'Phase Dash',
        color: pathColor('shredder'),
        path: 'shredder',
      },
    ]);
  });

  it('skips a cast whose unit id is not in the lookup (stale/unresolvable caster) rather than guessing a position', () => {
    const log = [entry('ability', 'champion-titan#999 stomped 1 enemies')];
    expect(deriveCombatSignals(log, 0, units).telegraphs).toEqual([]);
  });

  it('falls back to a generic label/color for an unknown champion contentId', () => {
    const withGhost: UnitLookupMap = buildUnitLookup([{ id: 5, lane: 0, x: 1, team: 'player' }]);
    const log = [entry('ultimate', 'champion-nonexistent#5 did something')];
    const out = deriveCombatSignals(log, 0, withGhost);
    expect(out.telegraphs).toEqual([
      { lane: 0, x: 1, team: 'player', tier: 'ultimate', label: 'Ultimate', color: colors.textDim, path: null },
    ]);
  });
});

describe('deriveCombatSignals — spawn (deploy + summon arrival)', () => {
  it('parses a player fighter deploy into a spawn signal', () => {
    const log = [entry('spawn', 'player deployed recruit x2 lane 0 @18')];
    const out = deriveCombatSignals(log, 0, EMPTY_UNITS);
    expect(out.spawns).toEqual([{ lane: 0, x: 18, team: 'player' }]);
  });

  it('parses an opponent summon (Mass Uprising Titan Guards) the same way — same log shape either path', () => {
    const log = [entry('spawn', 'opponent deployed titan-guard x1 lane 1 @55')];
    const out = deriveCombatSignals(log, 0, EMPTY_UNITS);
    expect(out.spawns).toEqual([{ lane: 1, x: 55, team: 'opponent' }]);
  });

  it('skips a malformed spawn entry', () => {
    const log = [entry('spawn', 'garbage entry that does not match')];
    expect(deriveCombatSignals(log, 0, EMPTY_UNITS).spawns).toEqual([]);
  });
});

describe('deriveCombatSignals — incremental scanning and unrelated entries', () => {
  it('a second call starting at the previous nextIndex returns only the NEW entries', () => {
    const log = [entry('fx', 'hit|0|1|10|player')];
    const first = deriveCombatSignals(log, 0, EMPTY_UNITS);
    expect(first.floaters).toHaveLength(1);
    expect(first.nextIndex).toBe(1);

    log.push(entry('fx', 'hit|0|1|10|player'), entry('fx', 'hit|0|1|10|player'));
    const second = deriveCombatSignals(log, first.nextIndex, EMPTY_UNITS);
    expect(second.floaters).toHaveLength(2);
    expect(second.nextIndex).toBe(3);
  });

  it('ignores log entry types with no visual mapping (death, command-rejected, synergy-on)', () => {
    const log = [
      entry('death', 'player recruit#3 killed by opponent'),
      entry('command-rejected', 'noop: bad'),
      entry('synergy-on', 'player some-synergy'),
    ];
    const out = deriveCombatSignals(log, 0, EMPTY_UNITS);
    expect(out.floaters).toEqual([]);
    expect(out.telegraphs).toEqual([]);
    expect(out.spawns).toEqual([]);
    expect(out.nextIndex).toBe(3);
  });
});

describe('latestMatchingHit', () => {
  // Legacy-shape hit (no targetId) — exercises the proximity fallback path
  // used for pre-P4 records/replays.
  const hit = (lane: 0 | 1, x: number, team: 'player' | 'opponent', bornAtMs: number) => ({
    lane,
    x,
    team,
    bornAtMs,
  });
  const idHit = (
    lane: 0 | 1,
    x: number,
    team: 'player' | 'opponent',
    bornAtMs: number,
    targetId: number | null
  ) => ({ lane, x, team, bornAtMs, targetId });

  it('proximity fallback: matches a hit in the same lane/team within tolerance', () => {
    const hits = [hit(0, 40, 'player', 1000)];
    expect(latestMatchingHit(7, 0, 41, 'player', hits, 3)?.bornAtMs).toBe(1000);
  });

  it('proximity fallback: rejects a hit in a different lane', () => {
    const hits = [hit(1, 40, 'player', 1000)];
    expect(latestMatchingHit(7, 0, 40, 'player', hits, 3)).toBeNull();
  });

  it('proximity fallback: rejects a hit on a different team', () => {
    const hits = [hit(0, 40, 'opponent', 1000)];
    expect(latestMatchingHit(7, 0, 40, 'player', hits, 3)).toBeNull();
  });

  it('proximity fallback: rejects a hit outside the tolerance radius', () => {
    const hits = [hit(0, 40, 'player', 1000)];
    expect(latestMatchingHit(7, 0, 50, 'player', hits, 3)).toBeNull();
  });

  it('picks the most recent among multiple matches', () => {
    const hits = [hit(0, 40, 'player', 1000), hit(0, 41, 'player', 2000), hit(0, 39, 'player', 500)];
    expect(latestMatchingHit(7, 0, 40, 'player', hits, 3)?.bornAtMs).toBe(2000);
  });

  it('returns null with no hits', () => {
    expect(latestMatchingHit(7, 0, 40, 'player', [], 3)).toBeNull();
  });

  it('P4 id match: an id-carrying hit matches ONLY its target unit, position-independent', () => {
    const hits = [idHit(0, 40, 'player', 1000, 7)];
    // The struck unit matches even far from the logged position (it moved)…
    expect(latestMatchingHit(7, 0, 90, 'player', hits, 3)?.bornAtMs).toBe(1000);
    // …while a same-team unit standing ON the logged spot does not (the P6
    // proximity-overmatch deferral this closes).
    expect(latestMatchingHit(8, 0, 40, 'player', hits, 3)).toBeNull();
  });

  it('P4: id-carrying and legacy hits mix — each matches by its own rule', () => {
    const hits = [idHit(0, 40, 'player', 2000, 7), hit(0, 40, 'player', 1000)];
    expect(latestMatchingHit(7, 0, 40, 'player', hits, 3)?.bornAtMs).toBe(2000);
    expect(latestMatchingHit(9, 0, 40, 'player', hits, 3)?.bornAtMs).toBe(1000);
  });
});

describe('deriveCoreHitIntensity', () => {
  it('is "none" when health did not decrease', () => {
    expect(deriveCoreHitIntensity(500, 500, 1000)).toBe('none');
    expect(deriveCoreHitIntensity(500, 600, 1000)).toBe('none'); // healed/repaired
  });

  it('is "normal" for a hit that leaves health above 25% max', () => {
    expect(deriveCoreHitIntensity(1000, 400, 1000)).toBe('normal');
  });

  it('is "severe" for a hit that leaves health at or below 25% max', () => {
    expect(deriveCoreHitIntensity(300, 250, 1000)).toBe('severe');
    expect(deriveCoreHitIntensity(1000, 0, 1000)).toBe('severe');
  });

  it('never divides by zero for a zero-maxHealth core (defensive; unreachable in real content)', () => {
    expect(() => deriveCoreHitIntensity(10, 5, 0)).not.toThrow();
    expect(deriveCoreHitIntensity(10, 5, 0)).toBe('normal');
  });
});
