/**
 * THE FORGE REVEAL — the chance side, and it can only add (Spec v5 §3 + v5.1).
 *
 * `forge_reveal_table` in the database is the authority; this is a first-paint
 * fallback and the pure arithmetic the UI needs. The test suite asserts the two
 * agree, so a table retuned in SQL without touching this file is caught rather
 * than shipped as a lie on the published table.
 *
 * WHAT IS NOT IN THIS FILE, DELIBERATELY:
 *
 *   no stake, no multiplier, no lane, no tier, no board, no "in play" balance.
 *
 * There is nothing to wager, so there is nothing here to wager it with. The
 * module-boundary test (domain/__tests__/module-boundaries.test.ts) additionally
 * refuses any import between this file's module and the pledge side, so a reveal
 * cannot come to depend on a trial or vice versa.
 *
 * The outcome is decided by the SERVER at claim time and returned before any
 * animation runs. Nothing here picks an outcome — `pickForDisplay` exists only so
 * a test can reason about the distribution, and it is never used to decide what an
 * athlete receives.
 */

/** One row of the published table. `weight` is per-mille, matching 161. */
export interface RevealOutcome {
  coins: number;
  weight: number;
  label: string;
}

/** What a banked, unclaimed reveal looks like to the client. */
export interface BankedReveal {
  id: string;
  producer: 'workout_complete' | 'pr';
  granted_at: string;
  training_day: string;
  exercise: string | null;
}

/** What the server returns from a claim. */
export interface ClaimedReveal {
  reveal_id: string;
  replayed: boolean;
  producer: 'workout_complete' | 'pr';
  coins: number;
  table_version: number;
  balance: number;
}

/**
 * A FIRST-PAINT FALLBACK AND NOTHING MORE — mirrors what 161 seeds, so the
 * published table can be drawn before the row arrives. §3 requires the table be
 * viewable BEFORE every reveal, and a spinner where the odds should be is a worse
 * answer than the real numbers a moment early.
 */
export const DEFAULT_REVEAL_TABLE: RevealOutcome[] = [
  { coins: 20, weight: 450, label: 'A steady pour' },
  { coins: 28, weight: 300, label: 'Clean billet' },
  { coins: 40, weight: 150, label: 'Well tempered' },
  { coins: 60, weight: 80, label: 'Fine steel' },
  { coins: 150, weight: 20, label: 'Masterwork' },
];

/** Weights are per-mille, so a full table sums to this. */
export const REVEAL_WEIGHT_TOTAL = 1000;

/** The chance of one outcome, as a fraction. */
export function revealChance(outcome: RevealOutcome, table = DEFAULT_REVEAL_TABLE): number {
  const total = table.reduce((s, o) => s + o.weight, 0);
  return total === 0 ? 0 : outcome.weight / total;
}

/** Average coins per reveal. §3 intends about 30 — "never a fortune". */
export function revealEv(table = DEFAULT_REVEAL_TABLE): number {
  const total = table.reduce((s, o) => s + o.weight, 0);
  if (total === 0) return 0;
  return table.reduce((s, o) => s + o.coins * o.weight, 0) / total;
}

/** "45%" — for the published table. Whole numbers: §2 wants legible ones. */
export function formatChance(fraction: number): string {
  const pct = fraction * 100;
  // 2% must not render as "2%" when it is really 2.0, and 0.5% must not render as
  // "1%". One decimal only when the whole number would be misleading.
  return pct >= 1 && Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(pct < 1 ? 2 : 1)}%`;
}

/** "+20" — a reveal is always a gain, so the sign is never in question. */
export function formatRevealCoins(coins: number): string {
  return `+${Math.round(coins)}`;
}

/** What earned this reveal, in words. Never mentions chance or luck. */
export function producerLabel(producer: BankedReveal['producer']): string {
  return producer === 'pr' ? 'Personal record' : 'Workout complete';
}

/** "2 reveals ready" / "1 reveal ready" — the Home chip and the summary card. */
export function bankedLabel(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '1 reveal ready' : `${count} reveals ready`;
}

export interface RevealTableProblem {
  problem: string;
}

/**
 * IS THIS TABLE SAFE TO PUBLISH?
 *
 * Run over the shipped fallback by the test suite and over the LIVE rows by the
 * falsification harness, exactly as `validateTier` was — so a retune done in SQL is
 * held to the same rules as one done here.
 *
 * The first rule is the whole point of the feature: every outcome adds. A zero or a
 * negative in this table would be a losing chance event, which is invariant 1.
 */
export function validateRevealTable(table = DEFAULT_REVEAL_TABLE): RevealTableProblem[] {
  const out: RevealTableProblem[] = [];
  const say = (problem: string) => out.push({ problem });

  if (table.length === 0) {
    say('the table is empty — there is nothing to reveal');
    return out;
  }
  for (const o of table) {
    // INVARIANT 1, at the top, because it is the one that matters.
    if (!(o.coins > 0)) say(`an outcome pays ${o.coins} — a reveal must always add`);
    if (!Number.isInteger(o.coins)) say(`${o.coins} is not a whole number of coins`);
    if (!(o.weight > 0)) say(`an outcome has weight ${o.weight} and can never occur`);
    if (!o.label.trim()) say(`the ${o.coins}-coin outcome has no label`);
  }

  const total = table.reduce((s, o) => s + o.weight, 0);
  if (total !== REVEAL_WEIGHT_TOTAL) {
    say(`weights sum to ${total} per-mille, not ${REVEAL_WEIGHT_TOTAL}`);
  }

  const ev = revealEv(table);
  if (ev < 25 || ev > 40) {
    say(`the reveal averages ${ev.toFixed(2)} coins, outside the 25-40 §3 intends`);
  }

  // §3: "ceiling one workout's base income, never a fortune." A full day is about
  // 200 coins, so a single reveal must not approach it.
  const best = Math.max(...table.map((o) => o.coins));
  if (best > 200) say(`the top outcome pays ${best} — more than a full training day`);

  // The rarest outcome should still be reachable rather than decorative.
  const rarest = Math.min(...table.map((o) => o.weight));
  if (rarest / total < 0.005) {
    say(`the rarest outcome is ${(rarest / total * 100).toFixed(3)}% — decorative, not reachable`);
  }
  return out;
}

/**
 * A WEIGHTED PICK, FOR TESTS ONLY.
 *
 * The server draws the real outcome; this exists so the suite can show the
 * published table and the distribution agree. It takes the roll as an argument
 * rather than calling `random()` itself — partly so it is deterministic, and partly
 * because a function in this file that generated its own randomness would be a
 * second source of truth about outcomes, which is exactly the thing that must not
 * exist on the client.
 */
export function pickForDisplay(roll: number, table = DEFAULT_REVEAL_TABLE): RevealOutcome {
  const total = table.reduce((s, o) => s + o.weight, 0);
  const target = Math.max(0, Math.min(total - 1, Math.floor(roll * total)));
  let running = 0;
  for (const o of table) {
    running += o.weight;
    if (target < running) return o;
  }
  return table[table.length - 1];
}
