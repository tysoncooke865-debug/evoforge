/**
 * Combat-feel effect derivation (P6) — pure functions that turn a slice of
 * the battle log, plus a snapshot of current unit positions, into short-lived
 * VISUAL signals: damage/heal/death floaters, ability/ultimate telegraphs,
 * and spawn/summon arrival markers. Also a pure comparator for core hit
 * flash/shake intensity from consecutive core-health snapshots.
 *
 * Deliberately mirrors the existing LaneFloater pattern (lane-strip.tsx):
 * this module produces RAW signals only (lane/x/team/label/color) — no
 * timestamps, no ageing, no caps. The caller (arena-screen.tsx's fx ref)
 * assigns bornAtMs when a signal is first observed and ages/prunes/caps it
 * every ~50ms render, exactly like the pre-existing floaters. That split
 * keeps every derivation here a pure function of (log, index, unit
 * positions) — trivially testable without React, timers, or the engine's
 * tick loop — while the component layer stays free of parsing logic.
 *
 * The engine's log is never mutated or added to from here: every signal is
 * derived from log entry types the engine ALREADY writes for other reasons
 * ('fx', 'ability', 'ultimate', 'spawn' — see game-engine/combat/combat.ts,
 * abilities/champion-abilities.ts, entities/spawn.ts). No engine/content
 * edits, no digest impact — visual layer only.
 */
import { getChampionById } from '../../../content/champions';
import { colors, pathColor } from '../../../constants/theme';
import type { BattleLogEntry } from '../../../game-engine/simulation/state';
import type { LaneId, TeamId } from '../../../game-engine/types';

/** Minimal per-unit facts the deriver needs to place a telegraph — a tiny
 *  slice of UnitState so this module never has to import the full shape. */
export interface UnitLookup {
  lane: LaneId;
  x: number;
  team: TeamId;
}

export type UnitLookupMap = ReadonlyMap<number, UnitLookup>;

/** Builds the id -> position/team lookup telegraphs are resolved against,
 *  from whatever unit list the caller already has each frame (alive or not —
 *  a champion that dashed and died the same tick should still telegraph from
 *  where it acted). */
export function buildUnitLookup(
  units: readonly { id: number; lane: LaneId; x: number; team: TeamId }[]
): UnitLookupMap {
  const map = new Map<number, UnitLookup>();
  for (const u of units) map.set(u.id, { lane: u.lane, x: u.x, team: u.team });
  return map;
}

export type FloaterKind = 'hit' | 'heal' | 'death';

/** Raw damage/heal/death signal — the caller turns this into a LaneFloater
 *  (adding key/topPct/bornAtMs) exactly as it always has. `amount` (P4) lets
 *  the wiring scale the number's size/weight by impact tier; 0 for deaths. */
export interface FloaterSignal {
  kind: FloaterKind;
  lane: LaneId;
  x: number;
  team: TeamId;
  text: string;
  color: string;
  amount: number;
}

/** A landed hit, kept separately (alongside its floater) so the caller can
 *  match it against the struck unit for a flash + recoil. P4: the engine's
 *  fx entry now carries the target unit id and a shield flag
 *  (`hit|lane|x|amount|team|id|sh`); `targetId` is null for entries from
 *  older records/replays, which fall back to proximity matching. */
export interface HitSignal {
  lane: LaneId;
  x: number;
  team: TeamId;
  targetId: number | null;
  amount: number;
  shielded: boolean;
}

export type TelegraphTier = 'ability' | 'ultimate';

/** An ability/ultimate cast, resolved to the caster's CURRENT position.
 *  P5: `path` is the caster champion's Avatar Path (null when the caster
 *  isn't a known champion) — it drives the per-path telegraph shapes. */
export interface TelegraphSignal {
  lane: LaneId;
  x: number;
  team: TeamId;
  tier: TelegraphTier;
  label: string;
  color: string;
  path: string | null;
}

/** A fighter card (or champion summon) landing — same signal serves both the
 *  "deploy feedback" and "summon arrival" requirements: both go through the
 *  engine's spawnUnitsForCard, which logs one 'spawn' entry per call either
 *  way (see entities/spawn.ts). */
export interface SpawnSignal {
  lane: LaneId;
  x: number;
  team: TeamId;
}

export interface DerivedCombatSignals {
  floaters: FloaterSignal[];
  hits: HitSignal[];
  telegraphs: TelegraphSignal[];
  spawns: SpawnSignal[];
  /** First log index NOT yet processed — pass back in as the next call's `fromIndex`. */
  nextIndex: number;
}

/** Every shipped ability/ultimate log line is authored as
 *  `${champion.contentId}#${id} …` (see champion-abilities.ts HANDLERS) —
 *  contentId first, matching the convention already relied on by
 *  __tests__/stability.test.ts. */
const CASTER_ID_RE = /^([\w-]+)#(\d+)/;

/** 'team deployed cardId xN lane L @x' (see entities/spawn.ts). */
const SPAWN_RE = /^(player|opponent) deployed \S+ x\d+ lane (\d) @(-?[\d.]+)/;

function laneOf(laneStr: string): LaneId {
  return laneStr === '1' ? 1 : 0;
}

/**
 * Scans `log[fromIndex..]` once, extracting every new floater/hit/telegraph/
 * spawn signal since the last call. Pure: no Date.now(), no mutation of
 * `log`, no engine imports. Malformed or unrecognised entries are skipped,
 * never thrown — untrusted/replayed logs must not crash the visual layer.
 */
export function deriveCombatSignals(
  log: readonly BattleLogEntry[],
  fromIndex: number,
  units: UnitLookupMap
): DerivedCombatSignals {
  const floaters: FloaterSignal[] = [];
  const hits: HitSignal[] = [];
  const telegraphs: TelegraphSignal[] = [];
  const spawns: SpawnSignal[] = [];

  let i = fromIndex;
  for (; i < log.length; i++) {
    const entry = log[i];

    if (entry.type === 'fx') {
      const [kind, laneStr, xStr, amountStr, team, idStr, shieldStr] = entry.detail.split('|');
      const lane = laneOf(laneStr);
      const x = Number(xStr);
      const amount = Number(amountStr);
      if (!Number.isFinite(x) || (team !== 'player' && team !== 'opponent')) continue;
      if (kind === 'hit') {
        if (!Number.isFinite(amount)) continue;
        // P4 trailing fields (target unit id, shield flag) — absent in
        // pre-polish records; parse fail-safe either way.
        const targetId = idStr !== undefined && Number.isFinite(Number(idStr)) ? Number(idStr) : null;
        const shielded = shieldStr === '1';
        floaters.push({
          kind: 'hit',
          lane,
          x,
          team,
          text: `-${amount}`,
          color: shielded ? colors.shield : team === 'player' ? colors.danger : colors.warning,
          amount,
        });
        hits.push({ lane, x, team, targetId, amount, shielded });
      } else if (kind === 'heal') {
        if (!Number.isFinite(amount)) continue;
        floaters.push({
          kind: 'heal',
          lane,
          x,
          team,
          text: `+${amount}`,
          color: colors.success,
          amount,
        });
      } else if (kind === 'death') {
        floaters.push({
          kind: 'death',
          lane,
          x,
          team,
          text: '✕',
          color: team === 'player' ? colors.player : colors.opponent,
          amount: 0,
        });
      }
      continue;
    }

    if (entry.type === 'ability' || entry.type === 'ultimate') {
      const match = CASTER_ID_RE.exec(entry.detail);
      if (!match) continue;
      const [, contentId, idStr] = match;
      const unit = units.get(Number(idStr));
      if (!unit) continue; // caster unresolvable (stale lookup) — skip, never guess a position
      const champion = getChampionById(contentId);
      const tier: TelegraphTier = entry.type;
      const label = champion
        ? tier === 'ultimate'
          ? champion.ultimate.name
          : champion.ability.name
        : tier === 'ultimate'
          ? 'Ultimate'
          : 'Ability';
      const color = champion ? pathColor(champion.path) : colors.textDim;
      telegraphs.push({
        lane: unit.lane,
        x: unit.x,
        team: unit.team,
        tier,
        label,
        color,
        path: champion?.path ?? null,
      });
      continue;
    }

    if (entry.type === 'spawn') {
      const match = SPAWN_RE.exec(entry.detail);
      if (!match) continue;
      const [, team, laneStr, xStr] = match;
      const x = Number(xStr);
      if (!Number.isFinite(x)) continue;
      spawns.push({ lane: laneOf(laneStr), x, team: team as TeamId });
    }
  }

  return { floaters, hits, telegraphs, spawns, nextIndex: i };
}

/**
 * The most recent hit signal for a unit. P4: hits carrying a target id
 * match EXACTLY (fixes the P6 proximity-overmatch deferral); id-less hits
 * (older records/replays) fall back to the original lane/team/proximity
 * match. Returns the matched hit itself (the renderer needs its amount and
 * shield flag for recoil/flash-tint), or null when nothing recent matches.
 */
export function latestMatchingHit<
  T extends { lane: LaneId; x: number; team: TeamId; bornAtMs: number; targetId?: number | null },
>(
  unitId: number,
  unitLane: LaneId,
  unitX: number,
  unitTeam: TeamId,
  hits: readonly T[],
  toleranceX: number
): T | null {
  let best: T | null = null;
  for (const hit of hits) {
    if (hit.targetId !== undefined && hit.targetId !== null) {
      if (hit.targetId !== unitId) continue;
    } else {
      if (hit.lane !== unitLane || hit.team !== unitTeam) continue;
      if (Math.abs(hit.x - unitX) > toleranceX) continue;
    }
    if (best === null || hit.bornAtMs > best.bornAtMs) best = hit;
  }
  return best;
}

export type CoreHitIntensity = 'none' | 'normal' | 'severe';

/**
 * Compares two consecutive Forge Core health snapshots to decide whether —
 * and how hard — to flash/shake the core sprite this frame. 'severe' covers
 * "more intense under 25% health": a core on the brink reads differently
 * from a glancing hit. Pure numeric comparison; the caller supplies the
 * previous frame's health (tracked in its own fx ref, like everything else
 * here) since core health mutates in place and carries no history itself.
 */
export function deriveCoreHitIntensity(
  prevHealth: number,
  nextHealth: number,
  maxHealth: number
): CoreHitIntensity {
  if (!(nextHealth < prevHealth)) return 'none';
  if (maxHealth > 0 && nextHealth / maxHealth <= 0.25) return 'severe';
  return 'normal';
}
