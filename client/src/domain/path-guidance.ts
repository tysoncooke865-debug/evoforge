/**
 * WHAT DO I ACTUALLY DO ABOUT THIS PATH? (Tyson, 2026-08-06.)
 *
 * The Forge showed a percentage and four nodes, and the answer to "how do I
 * move it" was a tap away inside a per-node sheet — so the headline number
 * looked like a score handed down rather than something the athlete controls.
 * The brief's shape:
 *
 *     "Strength: 56% complete. Next action: increase Bench Press e1RM from
 *      76 kg to 80 kg."
 *
 * ONE FORMATTER, so `46 / 100`, `16 / 200 sets` and `76 / 87.5 kg` are the
 * same shape everywhere and `46 / 100 /100` cannot be written: the unit rides
 * WITH the fraction instead of a caller appending a second denominator.
 *
 * This changes nothing about progression — no gate moves, nothing gets easier
 * or harder. It only says out loud what the engine already decided.
 */

export interface PathNodeLike {
  name: string;
  /** null = not tracked yet. */
  current: number | null;
  target: number;
  /** "kg", "km total", "sets", or "" for a bare count. */
  unit: string;
  /** 0..1, already clamped; null when untracked. */
  pct: number | null;
  nextAction: string;
  untrackedHint?: string;
}

/** 87.5 → "87.5"; 80.0 → "80". Never a trailing ".0" in a target. */
const trim = (v: number): string => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

/**
 * THE fraction format: `46 / 100`, `16 / 200 sets`, `76 / 87.5 kg`.
 *
 * The unit is appended ONCE, here — and a unit that is ITSELF a denominator is
 * dropped rather than repeated. That is not defensive tidiness: the Aesthetic
 * and Leanness nodes carried the literal unit `"/100"`, so the Forge shipped
 * `51 / 100 /100` on screen (found in the browser 2026-08-06 — invisible to a
 * source scan, because the doubling only happens at render). A formatter that
 * owns the shape has to own it against its callers too.
 */
export function formatFraction(current: number | null, target: number, unit = ''): string {
  const cleaned = unit.trim().replace(/^\/\s*\d+$/, ''); // "/100" is already said
  const suffix = cleaned === '' ? '' : ` ${cleaned}`;
  if (current === null) return `— / ${trim(target)}${suffix}`;
  return `${trim(current)} / ${trim(target)}${suffix}`;
}

export interface PathGuidance {
  /** "56% complete" — the path headline, in words. */
  headline: string;
  /** The node to work on next, or null when every node is maxed. */
  focus: PathNodeLike | null;
  /** "Bench Press · 76 / 87.5 kg" */
  measure: string | null;
  /** The imperative: what to do about it. */
  action: string | null;
  /** True when the focus node has no data source yet. */
  untracked: boolean;
}

/**
 * The path's next actionable requirement: the tracked node furthest from its
 * target, because that is where effort moves the percentage most.
 *
 * An UNTRACKED node is only offered once every tracked node is complete —
 * "set your deadlift e1RM in Profile" is a real action, but it should never
 * outrank "you are 40% of the way to the bench standard". A node with no data
 * source at all (`untrackedHint` and nothing the athlete can do) is skipped.
 */
export function pathGuidance(percent: number, nodes: readonly PathNodeLike[]): PathGuidance {
  const headline = `${Math.round(percent)}% complete`;

  const tracked = nodes.filter((n) => n.pct !== null && n.pct < 1);
  const untracked = nodes.filter((n) => n.pct === null);

  let focus: PathNodeLike | null = null;
  let isUntracked = false;
  if (tracked.length > 0) {
    focus = tracked.reduce((lowest, n) => ((n.pct ?? 1) < (lowest.pct ?? 1) ? n : lowest));
  } else if (untracked.length > 0) {
    focus = untracked[0];
    isUntracked = true;
  }

  if (focus === null) return { headline, focus: null, measure: null, action: null, untracked: false };

  return {
    headline,
    focus,
    measure: isUntracked ? null : `${focus.name} · ${formatFraction(focus.current, focus.target, focus.unit)}`,
    action: isUntracked ? (focus.untrackedHint ?? focus.nextAction) : focus.nextAction,
    untracked: isUntracked,
  };
}
