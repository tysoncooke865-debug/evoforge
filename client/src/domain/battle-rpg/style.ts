import type { BattleMove, BattleStyle, ChampionId } from './types';

/**
 * THE STYLE TRIANGLE (FireRed plan Phase C) — the strategic core.
 * FORCE (titan power) > FORM (aesthetic/shredded technique) > FLOW (apex
 * tempo) > FORCE. A move carries its champion's style; the multiplier is
 * judged against the DEFENDER's champion style. ×1.3 with the triangle,
 * ×0.77 against it, 1 otherwise — deterministic, applied in damage.ts only.
 */

export const CHAMPION_STYLE: Record<ChampionId, BattleStyle> = {
  titan: 'force',
  aesthetic: 'form',
  shredded: 'form',
  apex: 'flow',
};

/** style → the style it BEATS. */
const BEATS: Record<BattleStyle, BattleStyle> = {
  force: 'form',
  form: 'flow',
  flow: 'force',
};

export const STYLE_META: Record<BattleStyle, { label: string; icon: string; color: string }> = {
  force: { label: 'FORCE', icon: '▲', color: '#fb923c' },
  form: { label: 'FORM', icon: '◆', color: '#c084fc' },
  flow: { label: 'FLOW', icon: '●', color: '#22d3ee' },
};

export function styleOfChampion(id: ChampionId): BattleStyle {
  return CHAMPION_STYLE[id];
}

/** A move fights in its own style if set, else its champion's. */
export function styleOfMove(move: BattleMove): BattleStyle {
  return move.style ?? CHAMPION_STYLE[move.requiredChampion];
}

export type Effectiveness = 'super' | 'weak' | 'neutral';

export function styleEffectiveness(moveStyle: BattleStyle, defenderStyle: BattleStyle): Effectiveness {
  if (BEATS[moveStyle] === defenderStyle) return 'super';
  if (BEATS[defenderStyle] === moveStyle) return 'weak';
  return 'neutral';
}

export function styleMultiplier(eff: Effectiveness): number {
  return eff === 'super' ? 1.3 : eff === 'weak' ? 0.77 : 1;
}

/** One-line matchup hint for the pre-battle screen (D5). */
export function matchupHint(player: ChampionId, opponent: ChampionId): string {
  const eff = styleEffectiveness(CHAMPION_STYLE[player], CHAMPION_STYLE[opponent]);
  const ps = STYLE_META[CHAMPION_STYLE[player]].label;
  const os = STYLE_META[CHAMPION_STYLE[opponent]].label;
  if (eff === 'super') return `${ps} overpowers ${os} — your hits land ×1.3.`;
  if (eff === 'weak') return `${os} counters ${ps} — your hits land ×0.77. Guard and time your bursts.`;
  return `${ps} vs ${os} — an even matchup. Execution decides it.`;
}
