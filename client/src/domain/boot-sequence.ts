/**
 * THE FORGE INTRO'S TIMELINE (2026-08-03) — pure, so the sequence can be
 * reasoned about and pinned without a renderer.
 *
 * The brief specifies the beats by wall-clock second ("1.0s the hammer
 * strikes", "1.8s the tagline etches", "2.5s it opens"). Those are expressed
 * here as FRACTIONS of one clock, because the whole intro is driven by a
 * single 0→1 shared value: on web every Reanimated loop runs on the main JS
 * thread, so the cost of an animation is the number of DRIVERS, not the number
 * of effects, and six independent timers would also be six chances to drift
 * out of sync with each other.
 *
 * ---- WHY THE DURATION IS A CONSTANT AND NOT A PROMISE ----
 *
 * The intro is an OVERLAY over an app that is already mounting underneath, not
 * a gate in front of one (see ui/boot/boot-gate.tsx for why that distinction is
 * load-bearing on iOS). So it does not wait for the network, and it cannot make
 * the app slower than it would have been: it ends on a timer, the app is
 * already there, and anything still loading shows its own state afterwards.
 * The brief's "maximum total launch time ~3 seconds" is therefore a hard
 * property of these numbers rather than a hope about a fetch.
 */

/** The full sequence. The brief asks for 2.3–2.8s; this sits inside it. */
export const BOOT_TOTAL_MS = 2700;

/**
 * REDUCED MOTION. Not a fast-forward of the same animation — a different,
 * calmer one (see the component). Camera shake, the spiral and the particle
 * fields are the vestibular offenders and are simply not rendered; what is
 * left is a fade, a glow and the wordmark.
 */
export const BOOT_REDUCED_MS = 900;

/**
 * The belt to the timer's brace. If anything ever re-arms the intro or a
 * timer is throttled into oblivion (a tab launched in the background), this is
 * the second, independent deadline after which the overlay removes itself no
 * matter what. It is deliberately not tunable per stage: its whole job is to be
 * the thing that cannot be reasoned wrong.
 */
export const BOOT_HARD_CAP_MS = 4200;

export type BootStage = 'ember' | 'spiral' | 'strike' | 'forge' | 'etch' | 'open';

/**
 * Each stage as [from, to) on the 0→1 clock. Contiguous and exhaustive by
 * construction — a gap would be a frame with no stage, and an overlap would
 * make `stageAt` depend on iteration order.
 *
 *   ember   0.000–0.148   0–400ms      black; embers drift inward
 *   spiral  0.148–0.370   400–1000ms   they spiral; the sigil resolves; push-in
 *   strike  0.370–0.407   1000–1100ms  the hammer lands: flash, sparks, shake
 *   forge   0.407–0.667   1100–1800ms  molten fragments assemble the wordmark
 *   etch    0.667–0.907   1800–2450ms  the pulse crosses; the tagline burns in
 *   open    0.907–1.000   2450–2700ms  the wordmark dissolves upward; the app
 */
export const BOOT_STAGES: readonly (readonly [BootStage, number, number])[] = [
  ['ember', 0.0, 0.148],
  ['spiral', 0.148, 0.37],
  ['strike', 0.37, 0.407],
  ['forge', 0.407, 0.667],
  ['etch', 0.667, 0.907],
  ['open', 0.907, 1.0],
];

/** Stage bounds by name — what the component's worklets window against. */
export const STAGE: Readonly<Record<BootStage, readonly [number, number]>> = Object.fromEntries(
  BOOT_STAGES.map(([name, from, to]) => [name, [from, to] as const])
) as Readonly<Record<BootStage, readonly [number, number]>>;

/** The stage a 0→1 position falls in. Clamped at both ends. */
export function stageAt(t: number): BootStage {
  if (!(t > 0)) return 'ember';
  for (const [name, from, to] of BOOT_STAGES) {
    if (t >= from && t < to) return name;
  }
  return 'open';
}

/** Milliseconds → the 0→1 position. */
export const bootProgress = (ms: number, total = BOOT_TOTAL_MS): number =>
  Math.max(0, Math.min(1, ms / total));

/** When a stage begins, in milliseconds — what the mount timers are set to. */
export const stageStartMs = (stage: BootStage, total = BOOT_TOTAL_MS): number =>
  Math.round(STAGE[stage][0] * total);

/**
 * 0 outside [a,b], 0→1 across it. The one primitive every layer's worklet is
 * built from; exported (rather than redeclared in the component) so the tests
 * pin the same function the screen runs.
 */
export function seg(t: number, a: number, b: number): number {
  'worklet';
  return Math.max(0, Math.min(1, (t - a) / (b - a)));
}

/* ------------------------------------------------------------------ *
 * THE FORGE ENVIRONMENTS
 * ------------------------------------------------------------------ */

export type ForgeEnvironmentKey = 'cyber' | 'ancient' | 'space' | 'volcanic' | 'frozen';

export interface ForgeEnvironment {
  key: ForgeEnvironmentKey;
  /** Shown under the sigil for a beat — "SPACE FORGE". */
  label: string;
  /**
   * Theme token NAMES, resolved through useThemeColors at render — never hex.
   * `ember` tints the drifting particles and `halo` the far bloom.
   *
   * THE WORDMARK IS NEVER TINTED BY THIS. The brief asks for rotating
   * environments AND for the logo to always be the focus, and those two only
   * co-exist if the rotation stays in the background: EvoForge is electric
   * blue in every forge, and only the room around it changes.
   */
  ember: string;
  halo: string;
}

export const FORGE_ENVIRONMENTS: readonly ForgeEnvironment[] = [
  { key: 'cyber', label: 'CYBER FORGE', ember: 'accent', halo: 'accent-deep' },
  { key: 'ancient', label: 'ANCIENT FORGE', ember: 'legendary', halo: 'warn' },
  { key: 'space', label: 'SPACE FORGE', ember: 'rare', halo: 'epic' },
  { key: 'volcanic', label: 'VOLCANIC FORGE', ember: 'danger', halo: 'legendary' },
  { key: 'frozen', label: 'FROZEN FORGE', ember: 'accent-strong', halo: 'rare' },
];

/**
 * WHICH FORGE TODAY IS. Keyed to the athlete's LOCAL CALENDAR DAY rather than
 * to chance:
 *
 *   - it needs no storage and no counter, so the first frame is never wrong
 *     while an async read comes back,
 *   - `Math.random()` in render is a purity violation the React Compiler lint
 *     rejects, and seeding from a clock call has the same problem,
 *   - and "the forge changes each day" is a better product idea than "the
 *     forge is random": two launches five minutes apart looking different
 *     reads as a glitch, not as variety.
 *
 * A trivially weak hash is the right amount of hashing here — this picks one of
 * five backgrounds, and its only real requirement is that consecutive dates do
 * not collide.
 */
export function forgeEnvironmentFor(todayIso: string): ForgeEnvironment {
  let h = 0;
  for (let i = 0; i < todayIso.length; i++) h = (h * 31 + todayIso.charCodeAt(i)) >>> 0;
  return FORGE_ENVIRONMENTS[h % FORGE_ENVIRONMENTS.length];
}
