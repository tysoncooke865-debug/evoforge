/**
 * TRANSFORM P8 — the reduced-motion guard.
 *
 * `withRepeat` is Reanimated's ONLY looping primitive, and an ambient loop
 * that ignores the OS "reduce motion" setting is exactly the accessibility
 * bug this guard exists to catch. Rule: any component that calls withRepeat
 * must also consult useReducedMotion (directly, or by rendering nothing /
 * holding still when it is on).
 *
 * It found two real offenders the day it was written — the toast's XP pulse
 * (looped for the toast's whole life) and the HEADS OR TAILS coin (spun a
 * fast rotating object at a vestibular-sensitive athlete). Both fixed.
 *
 * The doctrine this obeys (client/CLAUDE.md): a guard that cannot fail is
 * not a guard. So:
 *   - it asserts the scanned set is NON-EMPTY (an empty glob would otherwise
 *     "pass" by having nothing to check),
 *   - it asserts the positive control: at least one file genuinely gates,
 *   - and it was falsified once by deleting a gate and watching it go red.
 *
 * Web note: CSS-driven loops (the sprite strips) are ALSO covered, because
 * the components that own them are the same ones that consult the hook.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const sources = walk(ROOT).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
if (sources.length === 0) {
  console.error('verify-motion: scanned ZERO source files — the glob is broken, not the code.');
  process.exit(2);
}

const LOOP = /withRepeat\s*\(/;
// The gate must be a real CALL. Matching the bare identifier `reducedMotion`
// let `const reducedMotion = false` pass — the first falsification run stayed
// green with the gate deliberately removed, which is precisely the vacuous
// guard the doctrine warns about. Only `useReducedMotion(` counts.
// useAmbient() is a COMPLIANT gate: it embeds useReducedMotion (and adds
// screen focus + perf mode) — see src/ui/core/use-ambient.ts. A file
// consulting either honours the setting.
const GATE = /(useReducedMotion|useAmbient)\s*\(/;

/**
 * PER-COMPONENT, NOT PER-FILE (tightened 2026-08-03).
 *
 * The file-wide test had a false negative that a falsification run caught:
 * `ui/train/week-bar.tsx` holds a gated one-shot (the completed day's tick)
 * AND a looping one (today's row breathing). Deleting the LOOP's gate left the
 * one-shot's `useReducedMotion` in the file, and the guard stayed green on a
 * genuinely broken loop. Any file that mixes a one-shot with a loop had the
 * same hole.
 *
 * So the scope is now the enclosing TOP-LEVEL declaration. `componentSlices`
 * walks back from a `withRepeat(` to the nearest COLUMN-ZERO `function` /
 * `const X =` / `class`, and forward to the next one; the gate must appear
 * inside THAT slice. Column zero is load-bearing: an indented `const beat =
 * useSharedValue(0)` sits between a component's gate and its loop, and
 * treating that as a boundary cut every component in half and made the guard
 * report that nothing was gated at all.
 *
 * ---- THE PARENT-GATES-CHILD ESCAPE ----
 *
 * Three files legitimately put the gate in the EXPORTED component and the loop
 * in a private child it decides whether to render at all (`CoinFlip` →
 * `NativeSpin`, `SpriteAvatar` → `NativeSprite`, `MoveFxLayer` → its effect
 * views). Those are correct, so a loop also counts as gated when any EXPORTED
 * declaration in the same file consults a gate — the exported thing is the
 * only way in.
 *
 * That escape is deliberately narrow, and it does NOT reopen the hole this
 * tightening closed: week-bar's gate lived in a PRIVATE helper (`StatusCircle`)
 * while the loop lived in the exported component, so an ungated loop there is
 * still red.
 *
 * It is a heuristic, not a parser — a loop inside a nested helper is attributed
 * to the top-level declaration that contains it, which is the right answer for
 * every case in this codebase.
 */
const DECL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+\w+|const\s+\w+\s*=|class\s+\w+)/;
const EXPORTED_DECL = /^export\s+(?:default\s+)?(?:async\s+)?(?:function\s+\w+|const\s+\w+\s*=|class\s+\w+)/;

const componentSlices = (lines, loopLineIdx) => {
  let start = 0;
  for (let i = loopLineIdx; i >= 0; i--) {
    if (DECL.test(lines[i])) {
      start = i;
      break;
    }
  }
  let end = lines.length;
  for (let i = loopLineIdx + 1; i < lines.length; i++) {
    if (DECL.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
};

const loopers = [];
const gated = [];
const offenders = [];

for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  if (!LOOP.test(text)) continue;
  loopers.push(file);
  const lines = text.split(/\r?\n/);
  // Does any EXPORTED declaration in this file consult a gate? If so the loop
  // may live in a private child it renders (the parent-gates-child escape).
  const exportedGated = lines.some((line, i) => EXPORTED_DECL.test(line) && GATE.test(componentSlices(lines, i)));
  const ungated = lines.some(
    (line, i) => LOOP.test(line) && !GATE.test(componentSlices(lines, i)) && !exportedGated
  );
  if (ungated) offenders.push(file);
  else gated.push(file);
}

// Positive controls: the scan must actually have found loops, and at least
// one of them must genuinely gate — otherwise "no offenders" would be the
// same observation as "nothing was tested".
if (loopers.length === 0) {
  console.error('verify-motion: found NO withRepeat callers. Either the animation layer was rewritten (update this guard) or the scan is broken.');
  process.exit(2);
}
if (gated.length === 0) {
  console.error('verify-motion: not one looping component consults useReducedMotion — the detector is matching nothing.');
  process.exit(2);
}

const rel = (f) => f.slice(f.indexOf('src'));

if (offenders.length > 0) {
  console.error(
    `verify-motion: ${offenders.length} component(s) loop an animation without honouring reduced motion:\n` +
      offenders.map((f) => `  - ${rel(f)}`).join('\n') +
      '\n\nGate the LOOP on useReducedMotion (hold it still or render nothing).\n' +
      'Never fast-forward a ONE-SHOT to comply — a fast-forwarded toast ends at\n' +
      'opacity 0, which is an invisible toast.'
  );
  process.exit(1);
}

console.log(
  `OK: ${loopers.length} looping components, all ${gated.length} honour reduced motion.`
);
