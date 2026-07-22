/**
 * Official-path squad ROLES (P12) — display metadata that NAMES what each
 * path's champion kit already does in a gym squad. Purely descriptive: the
 * mechanics are the champion's existing passive + ability (content/champions
 * interpreted by the engine's passive hooks) — nothing here adds or changes
 * behaviour, and no engine code reads this module.
 *
 * Honesty rules:
 *  - Borrowed champions bring their full kit + passive; probe tests in
 *    gym-roles.test.ts pin that every passive functions in the borrowed
 *    auto-cast context (team auras included).
 *  - Team-aura passives (Perpetual Motion, Flow State) benefit the whole
 *    squad even from a borrowed champion; the other passives are self-only.
 *    `teamAura` is DERIVED from champion content so the flag can never
 *    drift from the actual kit, and each summary names the passive it
 *    surfaces (both asserted by test).
 */
import { getChampionByPath } from '../../content';
import type { AvatarPath } from '../../game-engine/types';
import { ALL_AVATAR_PATHS } from '../../game-engine/types';

export interface PathSquadRole {
  path: AvatarPath;
  /** Chip label (e.g. 'Anchor'). */
  label: string;
  /** One-line mechanical meaning — names the passive/ability it surfaces. */
  summary: string;
  /** True when the path's passive is a TEAM aura (helps the squad even when borrowed). */
  teamAura: boolean;
}

/** Role copy per official path. The summaries only NAME existing mechanics. */
const ROLE_COPY: Record<AvatarPath, { label: string; summary: string }> = {
  titan: {
    label: 'Anchor',
    summary:
      'Frontline anchor — Iron Hide blunts every hit it takes; Quake Stomp stuns the fight around it.',
  },
  mass: {
    label: 'Bulwark',
    summary:
      'Area presence — Colossal Frame bulk grinds a lane down; Gravity Well slows every push near it.',
  },
  shredder: {
    label: 'Finisher',
    summary:
      'Kill closer — Killer Instinct punishes weakened targets; Phase Dash reaches them.',
  },
  cardio: {
    label: 'Pacer',
    summary:
      'Tempo support — Perpetual Motion speeds squad energy while alive; Lane Shift joins the fight that needs it.',
  },
  aesthetic: {
    label: 'Coach',
    summary:
      'Sustain support — Flow State boosts squad healing while alive; Stance Shift flexes to the moment.',
  },
};

/** The squad role for an Avatar Path slug; undefined for unknown paths. */
export function pathSquadRole(path: string): PathSquadRole | undefined {
  if (!(ALL_AVATAR_PATHS as readonly string[]).includes(path)) return undefined;
  const p = path as AvatarPath;
  const copy = ROLE_COPY[p];
  return {
    path: p,
    label: copy.label,
    summary: copy.summary,
    // Derived from content, never hand-maintained: a passive is squad-wide
    // exactly when the champion declares a teamAura effect.
    teamAura: getChampionByPath(p)?.passive.effects.teamAura !== undefined,
  };
}
